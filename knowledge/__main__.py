"""Run with python -m knowledge. All mutations are local and opt-in."""
import argparse
import html
import json
import re
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from .core import Corpus, ROOT, answer, citation, export, passage, read, write


def probe(corpus, video_id):
    """Probe actual watch-page caption tracks; a 200/empty body is a failure."""
    if video_id not in corpus.records: raise ValueError('Video is not in the pilot catalog')
    url = corpus.records[video_id]['url']
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=25) as res:
            page = res.read().decode('utf-8')
        m = re.search(r'"captionTracks":(\[.*?\])',page)
        if not m: raise ValueError('Watch page has no caption tracks (not proof captions do not exist)')
        tracks = json.loads(m[1])
        track = next((x for x in tracks if x.get('languageCode')=='en'), None)
        if track is None: raise ValueError('No English caption track listed; use manual import for other languages')
        # Do not log the temporary signed caption URL.
        with urllib.request.urlopen(track['baseUrl']+'&fmt=json3',timeout=25) as res:
            body = res.read()
        if not body.strip(): raise ValueError('Caption endpoint returned HTTP 200 with an empty body')
        data = json.loads(body)
        segments = [{'text':''.join(x.get('utf8','') for x in e['segs']).strip(),
                     'start_ms':e['tStartMs'],'duration_ms':e.get('dDurationMs',0)}
                    for e in data.get('events',[]) if e.get('segs')]
        segments = [s for s in segments if s['text']]
        path = corpus.state/'downloads'/(video_id+'.json')
        write(path, {'video_id':video_id,'has_transcript':bool(segments),'language_code':'en',
                     'kind':track.get('kind','manual'),'segments':segments})
        corpus.import_transcript(video_id,path,'youtube_captions')
        return 'Imported captions: '+video_id
    except Exception as exc:
        corpus.event(video_id,'failed',source='youtube_watch_signed_captions',reason=str(exc))
        return 'Import failed: '+str(exc)+'; manual transcript import remains available.'


def serve(corpus, port):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/':
                self.send_error(404); return
            body = (ROOT/'app.html').read_bytes()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        def do_POST(self):
            if self.path != '/ask': self.send_error(404); return
            if self.headers.get('Origin') not in {None,f'http://127.0.0.1:{port}',f'http://localhost:{port}'}:
                self.send_error(403); return
            try:
                n = int(self.headers.get('Content-Length','0'))
                if not 0 < n <= 8192: raise ValueError('Invalid request length')
                data = json.loads(self.rfile.read(n))
                q = data['question']
                if not isinstance(q,str) or not q.strip(): raise ValueError('Enter a question')
                if data.get('creator') is not None and not isinstance(data['creator'],str): raise ValueError('Invalid creator')
                body = json.dumps({'answer':answer(corpus,q,data.get('creator'))},ensure_ascii=False).encode()
            except (ValueError,KeyError,TypeError): self.send_error(400); return
            self.send_response(200); self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    server = ThreadingHTTPServer(('127.0.0.1',port),Handler)
    print(f'Local assistant: http://127.0.0.1:{port} (Ctrl+C to stop)',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


def main():
    p = argparse.ArgumentParser(description='CSB evidence-first knowledge pilot (local only)')
    p.add_argument('--state',type=Path,help='Private data directory outside the repository')
    sub = p.add_subparsers(dest='command',required=True)
    sub.add_parser('status'); sub.add_parser('validate')
    a=sub.add_parser('add-video'); a.add_argument('file',type=Path)
    a=sub.add_parser('ask'); a.add_argument('question'); a.add_argument('--creator')
    a=sub.add_parser('evidence'); a.add_argument('id'); a.add_argument('finding'); a.add_argument('--context',action='store_true')
    a=sub.add_parser('serve'); a.add_argument('--port',type=int,default=8765)
    a=sub.add_parser('export'); a.add_argument('--out',type=Path)
    a=sub.add_parser('import-transcript'); a.add_argument('id'); a.add_argument('file',type=Path)
    a.add_argument('--source',required=True,choices=['youtube_captions','creator_transcript','authorized_transcription','manual_transcript'])
    a.add_argument('--source-url')
    for name in ['reprocess','probe','retry']:
        a=sub.add_parser(name); a.add_argument('id')
    a=sub.add_parser('import-findings'); a.add_argument('id'); a.add_argument('file',type=Path)
    args=p.parse_args(); c=Corpus(args.state)
    if args.command=='ask': print(answer(c,args.question,args.creator))
    elif args.command=='evidence':
        r=c.records[args.id];f=next((f for f in r['findings'] if f['id']==args.finding),None)
        if f is None: raise ValueError('Unknown finding ID')
        print(f['summary'])
        for e in f['evidence']:
            print(citation(r,e))
            if args.context:
                if (e['source']=='transcript' and not r.get('transcript')) or (e['source']=='description' and 'description' not in r):
                    raise ValueError('Full context requires the private source archive')
                print(passage(r,e)[0])
            else: print(e['passage'])
    elif args.command=='serve': serve(c,args.port)
    elif args.command=='export': print(export(c,args.out or c.state/'exports'))
    elif args.command=='import-transcript':
        r=c.import_transcript(args.id,args.file,args.source,args.source_url); print(r['id'],r['coverage'],r['review_status'])
    elif args.command=='import-findings': c.import_findings(args.id,args.file); print('Imported evidence-linked findings')
    elif args.command=='add-video': c.add_video(args.file); print('Registered video; no speech or findings inferred')
    elif args.command=='reprocess': print(c.reprocess(args.id))
    elif args.command in {'probe','retry'}: print(probe(c,args.id))
    elif args.command=='validate': print('Validated',len(c.records),'video records and their evidence references')
    elif args.command=='status':
        for r in c.records.values(): print(r['id'],r['coverage'],r['review_status'],r['title'])
        path=c.state/'attempts.json'
        print('Local import attempts:',len(read(path)) if path.exists() else 0)

if __name__=='__main__':
    try: main()
    except (ValueError,KeyError,OSError) as exc:
        print('Error:',exc,file=sys.stderr); sys.exit(1)
