"""Reset only the marked, isolated tracking fixture on loopback port 18109."""
import json
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

origin = 'http://127.0.0.1:18109'
headers = {'Content-Type': 'application/json', 'X-Planner-Gateway': 'highlights-local-only', 'X-Planner-Session': 'highlights-local-session'}


def api(path, method='GET', data=None):
    request = Request(origin + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
    with urlopen(request, timeout=15) as response:
        return json.load(response) if response.status != 204 else None


assert api('/highlights/test-fixture') == {'fixture': 'disposable-highlights'}
api('/mandala', 'PUT', {'document': {'centerTitle': 'Balance', 'version': 1, 'nodes': []}})
for task in api('/tasks'):
    api(f'/tasks/{task["id"]}', 'DELETE')
for task in api('/recurrent-tasks'):
    api(f'/recurrent-tasks/{task["id"]}', 'DELETE')
prefs = api('/mandala/tracking/preferences', 'POST', {'timezone': 'America/Los_Angeles'})
today = datetime.now(ZoneInfo(prefs['timezone'])).date()
weekend = today + timedelta(days=(5 - today.weekday()) % 7)
nodes = []


def tile(id, title, parent=None, color=None, order=0):
    nodes.append({'id': id, 'title': title, 'parentId': parent, 'kind': 'connected', 'sortOrder': order, **({'color': color} if color else {})})


tile('health', 'Health', color='#D70FA3', order=0)
tile('yoga', 'Yoga', 'health')
tile('workout', 'Work Out', 'health', order=1)
tile('nature', 'Nature', color='#078A1B', order=1)
tile('hiking', 'Evening Hikes', 'nature')
tile('camping', 'Camping', 'nature', order=1)
tile('practical-life', 'Practical Life', color='#718096', order=2)
tile('visa', 'Visa review', 'practical-life')
tile('finances', 'Finances', color='#1872DD', order=3)
tile('credit-score', 'Credit score', 'finances')
api('/mandala', 'PUT', {'document': {'centerTitle': 'Balance', 'version': 1, 'nodes': nodes}})
base = dict(trackingType='frequency', targetCount=2, targetPeriod='week', intervalValue=2, intervalUnit='weeks',
            autoGenerateTasks=False, generationStrategy='distributed', generatedTaskTitle='', taskDestination='backlog')
for id, changes in [('hiking', {}), ('yoga', {'targetCount': 3}), ('camping', {'targetCount': 1, 'targetPeriod': 'month'}),
                    ('visa', {'trackingType': 'review'}), ('credit-score', {'trackingType': 'review', 'intervalValue': 30, 'intervalUnit': 'days'})]:
    api(f'/mandala/tracking/nodes/{id}', 'PUT', {'revision': 0, 'settings': {**base, **changes}})
for id in ['hiking', 'yoga', 'visa']:
    api(f'/mandala/tracking/nodes/{id}/activities', 'POST', {'id': f'sample-{id}', 'notes': 'Fictional activity for the local preview.'})
api('/mandala/tracking/nodes/camping/controls', 'POST', {'action': 'pause'})
for title, node, date, location in [('Weekend hike', 'hiking', weekend.isoformat(), 'today'),
                                    ('Choose a yoga class', 'yoga', None, 'backlog'),
                                    ('Pack for camping', 'camping', None, 'backlog')]:
    api('/tasks', 'POST', {'title': title, 'mandala_node_id': node, 'task_date': date, 'location': location,
                         'notes': 'Dummy sample. No real calendar or task data is used.'})
api('/mandala/notes', 'PUT', {'nodeId': 'hiking', 'day': today.isoformat(), 'text': 'A short evening walk helps me reset.\n\n- Keep this easy and enjoyable\n- Plan a longer walk at the weekend', 'revision': 0})
api('/mandala/tracking/evaluate', 'POST', {})
print('Sample Mandala ready: http://127.0.0.1:18109/preview')
