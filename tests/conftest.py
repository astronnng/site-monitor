import os
import sys
import tempfile

# Ensure project root is on sys.path so top-level modules (like app.py) are importable during tests
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

# Enable test mode before importing app to disable rate limiting and monitor loop
os.environ['TESTING'] = '1'
os.environ['START_MONITOR'] = '0'  # Disable background monitor thread

# Use a test directory for sites file (more reliable than /tmp on Windows)
test_dir = os.path.join(ROOT, '.test_data')
os.makedirs(test_dir, exist_ok=True)
_tmp_sites_file = os.path.join(test_dir, 'sites_test.yaml')
os.environ["SITES_FILE"] = _tmp_sites_file

# Clean up on exit
import atexit
def cleanup_test_data():
    try:
        if os.path.exists(_tmp_sites_file):
            os.remove(_tmp_sites_file)
        if os.path.exists(test_dir) and not os.listdir(test_dir):
            os.rmdir(test_dir)
    except Exception:
        pass

atexit.register(cleanup_test_data)
