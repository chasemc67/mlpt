"""Queue real speech clips for the Debug iPad simulator input adapter.

No transcript is supplied to the app. The service transcribes each WAV locally.
"""
import argparse
import json
import time
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--clip', help='Fixture name, without .wav')
parser.add_argument('--context', choices=['ready', 'exploring', 'answering', 'confirming', 'feedback', 'ending'])
parser.add_argument('--scenario', choices=['two-trial', 'end-session'])
parser.add_argument('--clear', action='store_true', help='Discard queued clips, without changing app state')
parser.add_argument('--save-log', help='Save the service audio-recognition log as JSON')
args = parser.parse_args()

def request(path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = Request('http://127.0.0.1:9333' + path, data=body, headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=5) as response:
        return json.load(response)

if args.clear:
    request('/clear', {})
steps = []
if args.clip:
    if not args.context:
        parser.error('--clip needs --context')
    steps = [(args.clip, args.context)]
elif args.scenario == 'two-trial':
    steps = [('start', 'ready'), ('explore', 'exploring'), ('repeat', 'exploring'),
             ('finish', 'exploring'), ('square', 'answering'), ('not-confirm', 'confirming'),
             ('change', 'confirming'), ('circle', 'answering'), ('yes', 'confirming'),
             ('next', 'feedback'), ('stop', 'exploring'), ('no', 'ending'),
             ('finish', 'exploring'), ('triangle', 'answering'), ('yes', 'confirming'),
             ('complete', 'feedback')]
elif args.scenario == 'end-session':
    steps = [('start', 'ready'), ('stop', 'exploring'), ('yes', 'ending')]

initial = request('/status')
if args.scenario and (initial.get('context') != 'ready' or time.time() - initial.get('lastPoll', 0) > 3):
    parser.error('Return the simulator app to its Ready screen first.')
for clip, context in steps:
    request('/enqueue', {'clip': clip, 'context': context})
    print(f'Queued {clip}.wav for {context}', flush=True)

if args.scenario:
    seen = len(initial.get('events', []))
    recognized = 0
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        status = request('/status')
        events = status.get('events', [])
        for event in events[seen:]:
            if event['event'] == 'recognized_audio':
                recognized += 1
                print('Heard: ' + event['text'], flush=True)
        seen = len(events)
        if not status['pending'] and recognized >= len(steps):
            break
        time.sleep(0.5)
    else:
        raise SystemExit('Audio sequence stalled. Inspect the current UI and /status; use --clear before retrying.')
    print('Audio sequence delivered and transcribed. Verify the summary and saved session in the simulator.', flush=True)

status = request('/status')
if args.save_log:
    from pathlib import Path
    Path(args.save_log).write_text(json.dumps(status, indent=2))
if not steps:
    print(json.dumps({k: v for k, v in status.items() if k != 'events'}, indent=2))
