"""Neutral synthetic speech for simulator integration tests; no cloned voices."""
from pathlib import Path
import subprocess,tempfile,json
out=Path(__file__).resolve().parents[1]/'tests/audio-fixtures'
out.mkdir(exist_ok=True)
phrases={
 'start':'Start session.', 'finish':'Finish trial.', 'square':'Square.', 'circle':'Circle.',
 'triangle':'Triangle.', 'yes':'Yes.', 'change':'Change.', 'next':'Next trial.',
 'complete':'Finish session.', 'repeat':'Repeat.', 'end':'End session.', 'no':'No.',
 'explore':'I notice something round. Perhaps a curve on the left.',
 'not-confirm':'That is not correct.', 'spelled-square':'S. Q. U. A. R. E.', 'stop':'Stop session.',
}
for name,text in phrases.items():
 with tempfile.TemporaryDirectory() as tmp:
  a=Path(tmp)/'voice.aiff'
  voice,rate,padding=('Samantha','145','adelay=300,apad=pad_dur=0.6') if name=='stop' else ('Daniel','150','apad=pad_dur=0.4')
  subprocess.run(['say','-v',voice,'-r',rate,'-o',str(a),text],check=True)
  subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(a),'-af',padding,'-ar','16000','-ac','1','-c:a','pcm_s16le',str(out/f'{name}.wav')],check=True)
(out/'manifest.json').write_text(json.dumps({'synthetic':True,'voice':'macOS Daniel; stop clip: Samantha','phrases':phrases},indent=2))
print(f'Created {len(phrases)} real WAV clips in {out}')
