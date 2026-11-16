"""Portable JSON corpus, exact evidence references, conservative lexical retrieval.

No model, credentials, external database, or automatic advice generation.
"""
from __future__ import annotations
import hashlib
import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VERSION = 'candidate-passages-v1'
VIDEO_ID = re.compile(r'^[A-Za-z0-9_-]{11}$')
KINDS = {'ingredient', 'batch_size', 'stage', 'technique', 'explanation', 'troubleshooting',
         'tasting', 'equipment', 'yeast', 'temperature', 'gravity', 'aging', 'abv'}
MODES = {'creator_advice', 'creator_statement', 'batch_result', 'ai_interpretation', 'ai_calculation'}
SOURCES = {'youtube_captions', 'creator_transcript', 'authorized_transcription', 'manual_transcript'}

def now():
    return datetime.now(timezone.utc).isoformat()

def default_state():
    return Path(os.environ.get('CSB_KNOWLEDGE_HOME', Path.home() / '.local/share/csb-knowledge'))

def private_path(path):
    path = Path(path).expanduser().resolve()
    if path == ROOT.parent or ROOT.parent in path.parents:
        raise ValueError('Private state and exports must be outside the public repository')
    return path

def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(value, out, ensure_ascii=False, indent=2, allow_nan=False)
            out.write('\n')
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

def valid_number(x):
    return isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x)

def validate_segments(segments):
    if not isinstance(segments, list) or not segments:
        raise ValueError('No transcript segments; do not import descriptions as speech')
    previous = -1
    timed = None
    for s in segments:
        if not isinstance(s.get('text'), str) or not s['text'].strip():
            raise ValueError('Empty transcript passage')
        start = s.get('start_ms')
        has_time = start is not None
        if timed is None: timed = has_time
        if timed != has_time: raise ValueError('Mixed timed and untimed segments')
        if has_time:
            duration = s.get('duration_ms', 0)
            if not valid_number(start) or start < 0 or start < previous or not valid_number(duration) or duration < 0:
                raise ValueError('Invalid or unordered timestamp')
            previous = start
    return segments

def parse_transcript(path, video_id):
    """Accept provider JSON, normalized JSON, WebVTT, SRT, or explicit plain text.

    Plain text has null times. Never infer times from line numbers or chapters.
    """
    if not VIDEO_ID.fullmatch(video_id): raise ValueError('Invalid video ID')
    path = Path(path)
    raw = path.read_text(encoding='utf-8-sig')
    if path.suffix.lower() == '.json':
        data = json.loads(raw)
        if 'data' in data and 'alexandria' in data['data']:
            item = data['data']['alexandria'][0]
            if item.get('error'): raise ValueError('Provider error: ' + str(item['error']))
            data = item['data']
        if data.get('video_id', video_id) != video_id: raise ValueError('Transcript/video ID mismatch')
        if data.get('has_transcript') is False: raise ValueError('Source reports no captions')
        segments = data.get('segments', [])
        language, kind = data.get('language_code'), data.get('kind', 'unknown')
    elif path.suffix.lower() in {'.vtt', '.srt'}:
        def milliseconds(s):
            parts = s.replace(',', '.').split(':')
            seconds = float(parts[-1]) + 60 * int(parts[-2])
            if len(parts) == 3: seconds += 3600 * int(parts[0])
            return round(seconds * 1000)
        segments = []
        for block in re.split(r'\n\s*\n', raw.replace('\r', '')):
            lines = block.splitlines()
            for i, line in enumerate(lines):
                m = re.match(r'(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s+-->\s+(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})', line)
                if m:
                    start, end = map(milliseconds, m.groups())
                    text = re.sub(r'<[^>]*>', '', ' '.join(lines[i+1:])).strip()
                    if text: segments.append({'start_ms': start, 'duration_ms': end-start, 'text': text})
                    break
        language, kind = None, 'unknown'
    else:
        segments = [{'text': p.strip(), 'start_ms': None, 'duration_ms': None}
                    for p in re.split(r'\n\s*\n', raw) if p.strip()]
        language, kind = None, 'unknown'
    return {'video_id': video_id, 'language': language, 'kind': kind,
            'segments': validate_segments(segments), 'sha256': hashlib.sha256(raw.encode()).hexdigest()}

def passage(record, evidence):
    source = evidence['source']
    if source == 'transcript':
        segments = record['transcript']['segments']
        first, last = evidence['segments']
        if not isinstance(first, int) or not isinstance(last, int) or not 0 <= first <= last < len(segments):
            raise ValueError('Evidence segment range out of bounds')
        return ' '.join(s['text'] for s in segments[first:last+1]), segments[first].get('start_ms')
    if source == 'description':
        return record['description'], None
    raise ValueError('Unknown evidence source')

def validate_finding(record, f):
    if f.get('kind') not in KINDS or f.get('mode') not in MODES: raise ValueError('Invalid finding kind/mode')
    if not f.get('id') or not f.get('summary') or not f.get('evidence'): raise ValueError('Finding lacks evidence')
    if f.get('review_status') not in {'pending', 'transcript_checked', 'source_checked'}:
        raise ValueError('Unknown review status')
    if f['review_status'] != 'pending' and not f.get('reviewed_by'): raise ValueError('Reviewer required')
    for e in f['evidence']:
        quote = e.get('passage', '')
        if not quote: raise ValueError('Supporting passage required')
        if e.get('start_ms') is not None and (not valid_number(e['start_ms']) or e['start_ms'] < 0):
            raise ValueError('Invalid citation timestamp')
        if e['source']=='description' and e.get('start_ms') is not None:
            raise ValueError('Descriptions do not have speech timestamps')
        if e['source'] == 'transcript' and record.get('transcript'):
            text, start = passage(record, e)
            if quote not in text: raise ValueError('Supporting passage does not match transcript')
            if e.get('start_ms') != start: raise ValueError('Citation timestamp does not match source')
            if e.get('source_sha256') != record['transcript']['sha256']:
                raise ValueError('Evidence belongs to a different transcript revision')
        elif e['source'] == 'description' and record.get('description') is not None:
            if quote not in record['description']: raise ValueError('Description passage does not match')
            if e.get('start_ms') is not None: raise ValueError('Descriptions do not have speech timestamps')
        elif e['source'] not in {'transcript','description'}: raise ValueError('Unknown evidence source')
        elif not e.get('source_sha256'): raise ValueError('Excerpt-only evidence requires a source fingerprint')
        if e['source']=='transcript' and not record.get('transcript'):
            if e['source_sha256'] != record.get('transcript_provenance',{}).get('sha256'):
                raise ValueError('Excerpt refers to another transcript revision')
    measure = f.get('measurement')
    if measure and (not measure.get('original') or not measure.get('role')):
        raise ValueError('Measurements need original text and stage/role')
    if measure and measure.get('normalized'):
        n = measure['normalized']
        if n['method'] != 'calculated' or n['unit'] != 'g' or n['inputs']['original_unit'] != 'lb':
            raise ValueError('Unsupported unit conversion')
        inputs = n['inputs']
        if inputs['factor_g_per_lb'] != 453.59237 or abs(n['value']-inputs['original_value']*453.59237)>1e-6:
            raise ValueError('Unit conversion does not match preserved inputs')
    calc = f.get('calculation')
    if f['mode'] == 'ai_calculation':
        if not calc or calc['formula'] != '(og - fermentation_fg) * 131.25': raise ValueError('Unsupported calculation')
        inputs = calc['inputs']
        by_id = {x['id']: x for x in record['findings']}
        for key, role in [('og', 'original_gravity'), ('fermentation_fg', 'fermentation_final_gravity')]:
            fact = by_id[inputs[key]['finding_id']]
            m = fact['measurement']
            if m['role'] != role or m.get('value') != inputs[key]['value'] or fact.get('flags'):
                raise ValueError('Calculation input has wrong gravity role, value, or unresolved flags')
        expected = round((inputs['og']['value'] - inputs['fermentation_fg']['value']) * 131.25, 2)
        if expected != calc['result']: raise ValueError('Calculation result mismatch')
    return f

def validate_record(record):
    if not VIDEO_ID.fullmatch(record['id']): raise ValueError('Invalid ID')
    if record['url'] != 'https://www.youtube.com/watch?v=' + record['id']: raise ValueError('Invalid video URL')
    for field in ['title','creator','published_at','retrieved_at','coverage','extraction_version','review_status']:
        if field not in record: raise ValueError('Missing ' + field)
    if record.get('transcript'): validate_segments(record['transcript']['segments'])
    ids = [f['id'] for f in record['findings']]
    if len(ids) != len(set(ids)): raise ValueError('Duplicate finding ID')
    for f in record['findings']: validate_finding(record, f)
    if record['coverage'] == 'description_only' and any(e['source']=='transcript' for f in record['findings'] for e in f['evidence']):
        raise ValueError('Description-only record contains speech findings')
    return record

class Corpus:
    def __init__(self, state=None):
        self.state = private_path(state or default_state())
        self.catalog = read(ROOT / 'pilot.json')
        records = self.catalog['videos']
        self.records = {r['id']: r for r in records}
        for path in (self.state / 'videos').glob('*.json'):
            r = validate_record(read(path)); self.records[r['id']] = r
        for r in self.records.values(): validate_record(r)

    def event(self, video_id, status, **details):
        path = self.state / 'attempts.json'
        events = read(path) if path.exists() else []
        events.append({'video_id': video_id, 'at': now(), 'status': status, **details})
        write(path, events)

    def save(self, record):
        validate_record(record)
        write(self.state / 'videos' / (record['id'] + '.json'), record)
        self.records[record['id']] = record

    def add_video(self, path):
        r = read(path)
        if r['id'] in self.records: raise ValueError('Video already exists; use import/reprocess')
        for field in ['title','creator','published_at','url']:
            if not isinstance(r.get(field),str) or not r[field].strip(): raise ValueError('Missing '+field)
        r.update(retrieved_at=now(),coverage='description_only',extraction_version=VERSION,
                 review_status='pending',findings=[],relations=[],completeness='unreviewed')
        self.save(r); self.event(r['id'],'registered')

    def import_transcript(self, video_id, path, source, source_url=None):
        if source not in SOURCES: raise ValueError('Unknown transcript source')
        try:
            t = parse_transcript(path, video_id)
            r = json.loads(json.dumps(self.records[video_id]))
            t.update({'source': source, 'source_url': source_url or r['url'], 'retrieved_at': now()})
            old = r.get('transcript', {}).get('sha256')
            if old == t['sha256']:
                self.event(video_id, 'duplicate_ignored', source=source); return r
            r['transcript'] = t
            r['coverage'] = 'transcript_backed'
            # Existing facts must be checked against the replacement source, never silently reused.
            same_reviewed_source = r.get('transcript_provenance', {}).get('sha256') == t['sha256']
            if not same_reviewed_source and any(e['source']=='transcript' for f in r['findings'] for e in f['evidence']):
                r['archived_findings'] = r.get('archived_findings', []) + r['findings']
                r['findings'] = []
            r['transcript_provenance'] = {k:t[k] for k in ['source','source_url','language','kind','sha256','retrieved_at']}
            r['transcript_provenance']['segment_count'] = len(t['segments'])
            r['review_status'] = r['review_status'] if same_reviewed_source else 'pending'
            self.save(r)
            self.event(video_id, 'imported', source=source, sha256=t['sha256'])
            return r
        except Exception as exc:
            self.event(video_id, 'failed', source=source, reason=str(exc)); raise

    def reprocess(self, video_id):
        r = self.records[video_id]
        if not r.get('transcript'): raise ValueError('Import a transcript first; speech cannot be inferred')
        candidates = []
        s = r['transcript']['segments']
        for i in range(0, len(s), 12):
            text = ' '.join(x['text'] for x in s[i:i+12])
            if re.search(r'sweet|gravity|yeast|nutrient|stuck|stall|taste|gallon|pound|ounce|temperature|rack|bottl|aging', text, re.I):
                candidates.append({'segments': [i, min(i+11,len(s)-1)], 'passage': text,
                                   'start_ms': s[i].get('start_ms'), 'review_status':'pending'})
        result = {'video_id':video_id, 'extraction_version':VERSION, 'source_sha256':r['transcript']['sha256'],
                  'processed_at':now(), 'candidates':candidates}
        path = self.state / 'candidates' / (video_id + '.json')
        write(path, result); self.event(video_id, 'reprocessed', extraction_version=VERSION)
        return path

    def import_findings(self, video_id, path):
        data = read(path); r = json.loads(json.dumps(self.records[video_id]))
        if data.get('video_id') != video_id: raise ValueError('Findings/video ID mismatch')
        if data['source_sha256'] != r['transcript']['sha256']: raise ValueError('Findings refer to an older transcript')
        r['findings'] = data['findings']; r['extraction_version'] = data['extraction_version']
        r['review_status'] = 'pending' if any(f['review_status']=='pending' for f in r['findings']) else 'transcript_checked'
        self.save(r); self.event(video_id, 'findings_imported', extraction_version=r['extraction_version'])

STOP = set('what does this creator recommend about the a an and or to of in is it are do how which videos discuss particular between recipe video its later where two sources disagree changed me my for from with on tell please can i you they their have has use using much many any some recommendations recommended say says explain find help'.split())
ALIASES = {'backsweetening': {'backsweetening','sweetening','sweeten','sweetened'},
           'fermentation': {'fermentation','ferment'},
           'problem': {'problem','stalled','stall','troubleshooting'},
           'tasting': {'tasting','taste','flavor'}, 'stuck': {'stuck','stalled','stall'},
           'aging': {'aging','aged','year'}}

def tokens(text):
    words = set(re.findall(r'[a-z0-9]+', text.lower())) - STOP
    for key, values in ALIASES.items():
        if words & (values | {key}): words |= values | {key}
    return words

def search(corpus, query, creator=None, limit=6):
    q = tokens(query)
    if not q: return []
    matches = []
    for r in corpus.records.values():
        if creator and creator.casefold() not in r['creator'].casefold(): continue
        for f in r['findings']:
            if f['review_status'] == 'pending': continue
            if re.search(r'recommend|advice|should',query,re.I) and f['mode']!='creator_advice': continue
            if re.search(r'problem|stuck|stall|troubleshoot',query,re.I):
                if f['kind']!='troubleshooting' and not set(f.get('topics',[])) & {'troubleshooting','stalled','stall'}: continue
            # Titles do not prove a finding. Match only evidence-linked notes and tags.
            words = tokens(f['summary'] + ' ' + ' '.join(f.get('topics', [])))
            score = len(q & words)
            if score and score / len(q) >= .4:
                matches.append((score/len(q), r, f))
    matches.sort(key=lambda m:(-m[0], m[1]['id'], m[2]['id']))
    return matches[:limit]

def citation(r, e):
    ms = e.get('start_ms')
    if ms is None: label, url = e['source'] + '; no timestamp', r['url']
    else:
        secs = int(ms // 1000); label = f'{secs//60}:{secs%60:02}'
        url = r['url'] + '&t=' + str(secs) + 's'
    return f'[{r["title"]} — {label}]({url})'

def render_finding(r, f):
    flags = (' Review flags: ' + '; '.join(x.rstrip('.') for x in f['flags']) + '.') if f.get('flags') else ''
    refs = ' '.join(citation(r,e) for e in f['evidence'])
    source = 'description'
    if any(e['source']=='transcript' for e in f['evidence']):
        p = r.get('transcript_provenance',{})
        source = ('automatic captions' if p.get('kind')=='asr' else 'transcript') + (' ('+p['language']+')' if p.get('language') else '')
    return f'- **{r["creator"]} / {f["mode"].replace("_"," ")}**: {f["summary"]}{flags} Source: {source}. {refs}'

def answer(corpus, query, creator=None):
    lower = query.lower()
    requested = set(re.findall(r'[a-z0-9]+',lower)) - STOP
    known = set()
    for r in corpus.records.values():
        for f in r['findings']:
            if f['review_status']!='pending': known |= tokens(f['summary']+' '+' '.join(f.get('topics',[])))
    known |= {'change','changes','tasting','taste','flavor','followup','follow','up','conflict','conflicts','contradict','disagreement','sources','stuck','problem','ferment'}
    missing = requested - known
    if missing:
        return 'Insufficient evidence: no reviewed findings cover these query terms: ' + ', '.join(sorted(missing)) + '.'
    if re.search(r'disagree|conflict|contradict', lower):
        lines = ['Potential differences in this collection (not universal brewing rules):']
        for c in corpus.catalog.get('comparisons', []):
            requested = tokens(query) - {'conflict','contradict','disagreement','potential'}
            if requested and not requested & tokens(c['summary']): continue
            a,b = [corpus.records[i] for i in c['videos']]
            if creator and not all(creator.casefold() in r['creator'].casefold() for r in [a,b]): continue
            lines.append('\n' + c['summary'])
            for r, fid in zip([a,b], c['findings']):
                f = next((x for x in r['findings'] if x['id']==fid and x['review_status']!='pending'), None)
                if f: lines.append(render_finding(r,f))
                else: return 'Insufficient evidence: comparison needs review after reprocessing.'
        return '\n'.join(lines) if len(lines)>1 else 'Insufficient evidence: no reviewed disagreement.'
    if re.search(r'what changed|change.*between', lower) and tokens(query) <= {'avocado','tasting','taste','flavor','followup','follow','up'}:
        pair = corpus.catalog['followup_comparison']
        lines = [pair['summary']]
        for vid, fid in pair['findings']:
            r = corpus.records[vid]
            if creator and creator.casefold() not in r['creator'].casefold(): return 'Insufficient evidence for this creator.'
            f = next((x for x in r['findings'] if x['id']==fid and x['review_status']!='pending'), None)
            if not f: return 'Insufficient evidence: follow-up needs review after reprocessing.'
            lines.append(render_finding(r,f))
        return '\n\n'.join(lines)
    results = search(corpus, query, creator)
    if not results: return 'Insufficient evidence: the pilot has no reviewed finding that answers this question.'
    return '\n\n'.join(['Relevant evidence from the pilot; this is not a complete brewing reference.'] +
                       [render_finding(r,f) for _,r,f in results] +
                       ['Collection limits: findings are partial; captions may contain errors. A batch result or creator preference is not an established rule.'])

def export(corpus, directory):
    directory = private_path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for r in corpus.records.values():
        lines = ['---', 'title: ' + json.dumps(r['title']), 'creator: ' + json.dumps(r['creator']),
                 'video_id: ' + r['id'], 'coverage: ' + r['coverage'], '---', '',
                 '# ' + r['title'], '', r['url'], '',
                 'Published: '+str(r['published_at'])+' | Retrieved: '+r['retrieved_at'],
                 'Review: '+r['review_status']+' | Extraction: '+r['extraction_version'], '',
                 'Partial notes. Caption review does not mean audiovisual verification.', '']
        lines += [render_finding(r,f) for f in r['findings'] if f['review_status']!='pending']
        if not r['findings']: lines.append('Insufficient evidence: no reviewed findings.')
        (directory / (r['id']+'.md')).write_text('\n\n'.join(lines)+'\n',encoding='utf-8')
    return directory
