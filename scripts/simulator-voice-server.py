"""Loopback-only speech harness. Receives WAVs, recognizes actual audio with Whisper.
The iOS adapter is compiled out of Release and physical-device builds.
"""
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import argparse,json,threading,time,subprocess,tempfile
parser=argparse.ArgumentParser()
parser.add_argument('--model',required=True,type=Path)
args=parser.parse_args()
model=args.model.resolve()
fixtures=Path(__file__).resolve().parents[1]/'tests/audio-fixtures'
lock=threading.Lock(); pending=[]; events=[]; status={}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def reply(self,code,data=None,mime='application/json'):
  self.send_response(code);self.send_header('Content-Type',mime);self.end_headers()
  if data is not None: self.wfile.write(data if isinstance(data,bytes) else json.dumps(data).encode())
 def do_GET(self):
  u=urlparse(self.path)
  if u.path=='/status':
   with lock: result={**status,'pending':list(pending),'events':list(events)}
   return self.reply(200,result)
  if u.path!='/next':return self.reply(404)
  q=parse_qs(u.query);context=q.get('context',[''])[0];generation=q.get('generation',[''])[0]
  with lock:
   status.update(context=context,generation=generation,lastPoll=time.time())
   item=pending.pop(0) if pending and pending[0]['context']==context else None
   if item: events.append({'event':'audio_delivered','clip':item['clip'],'context':context,'generation':generation,'at':time.time()})
  if not item:return self.reply(204)
  self.reply(200,(fixtures/(item['clip']+'.wav')).read_bytes(),'audio/wav')
 def do_POST(self):
  length=int(self.headers.get('Content-Length',0))
  if length>4_000_000:return self.reply(413)
  data=self.rfile.read(length)
  if self.path=='/clear':
   with lock:pending.clear()
   return self.reply(200,{'cleared':True})
  if self.path=='/enqueue':
   try:
    item=json.loads(data);name=item['clip'];context=item['context']
    if not name.replace('-','').isalnum() or not (fixtures/(name+'.wav')).is_file():raise ValueError('Unknown audio clip')
    if context not in ['ready','exploring','answering','confirming','feedback','ending']:raise ValueError('Unknown context')
    with lock:pending.append({'clip':name,'context':context})
    return self.reply(200,{'queued':name})
   except (ValueError,KeyError) as e:return self.reply(400,{'error':str(e)})
  if self.path!='/transcribe':return self.reply(404)
  try:
   if data[:4]!=b'RIFF' or data[8:12]!=b'WAVE':raise ValueError('WAV required')
   with tempfile.TemporaryDirectory(prefix='mlpt-asr-') as tmp:
    wav=Path(tmp)/'input.wav';wav.write_bytes(data);out=Path(tmp)/'result'
    result=subprocess.run(['whisper-cli','-m',str(model),'-f',str(wav),'-l','en','-nt','-np','-otxt','-of',str(out),'-t','4','-ng'],capture_output=True,text=True,timeout=45)
    if result.returncode:raise RuntimeError(result.stderr[-600:])
    text=out.with_suffix('.txt').read_text().strip()
   with lock:events.append({'event':'recognized_audio','text':text,'bytes':len(data),'at':time.time()})
   print(json.dumps({'recognized_audio':text,'bytes':len(data)}),flush=True)
   self.reply(200,{'text':text,'engine':'whisper.cpp base.en','syntheticFixture':True})
  except Exception as e:self.reply(500,{'error':str(e)})
print('MLPT audio fixture service: http://127.0.0.1:9333',flush=True)
ThreadingHTTPServer(('127.0.0.1',9333),Handler).serve_forever()
