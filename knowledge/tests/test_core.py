"""Synthetic fixtures below are pipeline tests, not brewing evidence."""
import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from knowledge.core import (Corpus, ROOT, answer, citation, digest, export, parse_transcript,
                            passage, read, search, validate_finding, validate_record, validate_segments, write)

class KnowledgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.c = Corpus(self.base/'state')
        self.vid = 'AtZE2YKbeUA'  # public pilot failure; synthetic imports never leave this temp dir

    def file(self,name,value):
        path=self.base/name
        if isinstance(value,str): path.write_text(value)
        else: write(path,value)
        return path

    def transcript(self,vid=None,text='Synthetic pipeline passage, not brewing advice.'):
        return self.file('input.json',{'video_id':vid or self.vid,'has_transcript':True,'language_code':'en','kind':'manual',
            'segments':[{'text':text,'start_ms':12500,'duration_ms':2000}]})

    def imported(self):
        return self.c.import_transcript(self.vid,self.transcript(),'manual_transcript')

    def test_catalog_has_ten_unique_videos_and_honest_failure(self):
        self.assertEqual(len(self.c.records),10)
        self.assertEqual(sum(r['coverage']=='transcript_backed' for r in self.c.records.values()),9)
        self.assertEqual(self.c.records[self.vid]['coverage'],'description_only')
        self.assertFalse(self.c.records[self.vid]['findings'])

    def test_pilot_has_no_full_transcripts_or_description_blobs(self):
        for r in self.c.records.values():
            self.assertNotIn('transcript',r); self.assertNotIn('description',r)

    def test_rejects_out_of_order_negative_nonfinite_and_mixed_times(self):
        for times in [[2,1],[-1],[float('nan')],[True],[0,None]]:
            with self.subTest(times=times),self.assertRaises(ValueError):
                validate_segments([{'text':'synthetic','start_ms':t,'duration_ms':1} for t in times])

    def test_empty_or_wrong_video_transcript_never_promotes_failure(self):
        for data in [{'has_transcript':False},{'segments':[]},{'data':{'alexandria':[{'error':{'code':'limited'}}]}}]:
            with self.assertRaises(ValueError):self.c.import_transcript(self.vid,self.file('bad.json',data),'youtube_captions')
        with self.assertRaises(ValueError):self.c.import_transcript(self.vid,self.transcript('geBml1e3zFY'),'manual_transcript')
        self.assertEqual(self.c.records[self.vid]['coverage'],'description_only')
        self.assertEqual(len(read(self.c.state/'attempts.json')),4)

    def test_retry_after_failure_and_duplicate_do_not_duplicate_video(self):
        with self.assertRaises(ValueError):self.c.import_transcript(self.vid,self.file('empty.json',{'segments':[]}),'manual_transcript')
        self.imported(); self.c.import_transcript(self.vid,self.transcript(),'manual_transcript')
        self.assertEqual(len(self.c.records),10)
        self.assertEqual([x['status'] for x in read(self.c.state/'attempts.json')],['failed','imported','duplicate_ignored'])

    def test_plain_text_has_no_fabricated_timestamps(self):
        t=parse_transcript(self.file('manual.txt','Synthetic untimed speech.'),self.vid)
        self.assertIsNone(t['segments'][0]['start_ms'])

    def test_vtt_and_srt_preserve_times(self):
        for name,text in [('a.vtt','WEBVTT\n\n00:01.250 --> 00:03.000\nSynthetic speech.'),
                          ('a.srt','1\n00:00:01,250 --> 00:00:03,000\nSynthetic speech.')]:
            t=parse_transcript(self.file(name,text),self.vid)
            self.assertEqual(t['segments'][0]['start_ms'],1250)
            self.assertEqual(t['segments'][0]['duration_ms'],1750)

    def fixture_finding(self,r):
        return {'id':'test','kind':'explanation','mode':'creator_statement','summary':'Synthetic test.',
            'review_status':'transcript_checked','reviewed_by':'test reviewer','flags':[],
            'evidence':[{'source':'transcript','segments':[0,0],'start_ms':12500,
                         'passage':r['transcript']['segments'][0]['text'],'source_sha256':r['transcript']['sha256']}]}

    def test_evidence_quote_timestamp_range_and_revision_are_verified(self):
        r=self.imported();f=self.fixture_finding(r)
        validate_finding(r,f)
        for key,value in [('passage','Invented speech'),('start_ms',13000),('segments',[0,1]),('source_sha256','stale')]:
            bad=copy.deepcopy(f);bad['evidence'][0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):validate_finding(r,bad)

    def test_description_cannot_claim_timestamps(self):
        r=copy.deepcopy(self.c.records['geBml1e3zFY']);f=r['findings'][0]
        f['evidence'][0]['start_ms']=100
        with self.assertRaises(ValueError):validate_finding(r,f)

    def test_replacement_archives_and_removes_old_claims(self):
        r=self.imported();r['findings']=[self.fixture_finding(r)];self.c.save(r)
        r=self.c.import_transcript(self.vid,self.transcript(text='Different synthetic speech.'),'manual_transcript')
        self.assertFalse(r['findings']);self.assertEqual(len(r['archived_findings']),1)
        self.assertEqual(r['review_status'],'pending')

    def test_reprocess_only_creates_pending_candidates(self):
        self.c.import_transcript(self.vid,self.transcript(text='Synthetic yeast and gravity test.'),'manual_transcript')
        data=read(self.c.reprocess(self.vid))
        self.assertEqual(data['candidates'][0]['review_status'],'pending')
        self.assertFalse(self.c.records[self.vid]['findings'])

    def test_import_findings_rejects_stale_hash_and_mismatched_id(self):
        r=self.imported();data={'video_id':self.vid,'source_sha256':'old','findings':[self.fixture_finding(r)],'extraction_version':'test'}
        with self.assertRaises(ValueError):self.c.import_findings(self.vid,self.file('f.json',data))
        data.update(source_sha256=r['transcript']['sha256'],video_id='geBml1e3zFY')
        with self.assertRaises(ValueError):self.c.import_findings(self.vid,self.file('f.json',data))

    def test_calculation_rejects_backsweetened_fg_and_wrong_result(self):
        r=copy.deepcopy(self.c.records['qupXap5BBOE']);f=next(f for f in r['findings'] if f['id']=='calculated_abv')
        self.assertEqual(f['calculation']['result'],9.45)
        bad=copy.deepcopy(f);bad['calculation']['inputs']['fermentation_fg']={'finding_id':'sweet','value':1.013}
        with self.assertRaises(ValueError):validate_finding(r,bad)
        bad=copy.deepcopy(f);bad['calculation']['result']=12
        with self.assertRaises(ValueError):validate_finding(r,bad)

    def test_normalization_preserves_and_checks_inputs(self):
        r=copy.deepcopy(self.c.records['geBml1e3zFY']);f=r['findings'][0]
        self.assertIn('2 1/2 lbs',f['measurement']['original'])
        f['measurement']['normalized']['value']=1
        with self.assertRaises(ValueError):validate_finding(r,f)

    def test_advice_question_returns_attributed_advice(self):
        result=answer(self.c,'What does this creator recommend about backsweetening?')
        self.assertIn('small increments',result);self.assertIn('no single preferred',result)
        self.assertNotIn('/ batch result',result);self.assertIn('&t=',result)

    def test_followup_answer_has_original_and_actual_changes(self):
        result=answer(self.c,'What changed between a recipe video and its later tasting?')
        self.assertIn('geBml1e3zFY',result);self.assertIn('EFPxb3n2Wuc',result)
        self.assertIn('2 small Whole Clove',result);self.assertIn('1.012',result);self.assertIn('1.022',result)

    def test_fermentation_problem_search_and_creator_filter(self):
        result=answer(self.c,'Which videos discuss a stalled fermentation problem?')
        self.assertIn('-0mXCpl6KfY',result);self.assertIn('TM83WJvfKBA',result)
        self.assertIn('Insufficient evidence',answer(self.c,'backsweetening','Doin the Most'))

    def test_conflicts_preserve_uncertainty_and_chronology(self):
        result=answer(self.c,'Where do two sources disagree?')
        self.assertIn('candidate transcription conflict',result);self.assertIn('change in experience',result)
        self.assertIn('Insufficient evidence',answer(self.c,'Where do sources disagree on botulism?'))

    def test_unsupported_question_does_not_invent_answer(self):
        self.assertIn('Insufficient evidence',answer(self.c,'How do I measure arsenic contamination?'))
        self.assertIn('Insufficient evidence',answer(self.c,'backsweetening with xylitol'))
        self.assertIn('Insufficient evidence',answer(self.c,'What does Doin the Most recommend about bentonite?'))

    def test_pending_claims_are_not_retrieved(self):
        for r in self.c.records.values():
            for f in r['findings']:f['review_status']='pending'
        self.assertIn('Insufficient evidence',answer(self.c,'backsweetening'))

    def test_markdown_exports_omit_full_transcripts_and_keep_untimed_labels(self):
        dest=export(self.c,self.base/'exports');files=list(dest.glob('*.md'))
        self.assertEqual(len(files),10)
        text=(dest/'geBml1e3zFY.md').read_text()
        self.assertIn('description; no timestamp',text);self.assertNotIn('segments',text)
        self.assertIn('description_only',(dest/(self.vid+'.md')).read_text())

    def test_private_state_and_export_refuse_public_repository(self):
        with self.assertRaises(ValueError):Corpus(ROOT/'private')
        with self.assertRaises(ValueError):export(self.c,ROOT/'exports')

    def test_add_new_creator_metadata_without_inventing_findings(self):
        path=self.file('new.json',{'id':'aaaaaaaaaaa','title':'Synthetic example','creator':'Test creator',
                                'published_at':'2026-01-01','url':'https://www.youtube.com/watch?v=aaaaaaaaaaa'})
        self.c.add_video(path)
        self.assertFalse(self.c.records['aaaaaaaaaaa']['findings'])
        with self.assertRaises(ValueError):self.c.add_video(path)

if __name__=='__main__':unittest.main()
