import json
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

class LocalAPITests(unittest.TestCase):
    def test_question_api_and_private_route_isolation(self):
        with tempfile.TemporaryDirectory() as state:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            proc=subprocess.Popen([sys.executable,'-m','knowledge','--state',state,'serve','--port',str(port)],
                                  stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=Path(__file__).resolve().parents[2])
            try:
                base=f'http://127.0.0.1:{port}'
                for _ in range(60):
                    try:
                        with urllib.request.urlopen(base,timeout=.2) as r:self.assertEqual(r.status,200)
                        break
                    except (OSError,urllib.error.URLError):time.sleep(.05)
                else:self.fail('Local server did not start')
                for path in ['/videos/geBml1e3zFY.json','/../index.html','/knowledge/pilot.json']:
                    with self.assertRaises(urllib.error.HTTPError) as ctx:urllib.request.urlopen(base+path)
                    self.assertEqual(ctx.exception.code,404)
                data=json.dumps({'question':'What does this creator recommend about backsweetening?'}).encode()
                with urllib.request.urlopen(urllib.request.Request(base+'/ask',data,{'Content-Type':'application/json'})) as r:
                    text=json.load(r)['answer'];self.assertIn('small increments',text);self.assertIn('&t=',text)
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(urllib.request.Request(base+'/ask',data,{'Origin':'https://unrelated.example'}))
                self.assertEqual(ctx.exception.code,403)
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(urllib.request.Request(base+'/ask',b'{bad json'))
                self.assertEqual(ctx.exception.code,400)
            finally:
                proc.terminate();proc.communicate(timeout=5)

if __name__=='__main__':unittest.main()
