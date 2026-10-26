# Test cases for vaani-py.yaml (run: semgrep --test security/semgrep). Not application code.
import hashlib
import os
import pickle
import subprocess

import httpx
import yaml

user = "x"

# ruleid: vaani-py-no-shell
subprocess.run(user, shell=True)
# ruleid: vaani-py-no-shell
os.system(user)
# ok: vaani-py-no-shell
subprocess.run(["git", "status"], check=False)

# ruleid: vaani-py-no-eval
eval(user)
# ruleid: vaani-py-no-eval
exec(user)
# ok: vaani-py-no-eval
int(user)

# ruleid: vaani-py-no-unsafe-load
pickle.loads(user)
# ruleid: vaani-py-no-unsafe-load
yaml.load(user)
# ok: vaani-py-no-unsafe-load
yaml.safe_load(user)

# ruleid: vaani-py-no-weak-hash
hashlib.md5(user)
# ok: vaani-py-no-weak-hash
hashlib.sha256(user)

# ruleid: vaani-py-tls-verify
httpx.get("https://example.org", verify=False)
# ok: vaani-py-tls-verify
httpx.get("https://example.org")

# ruleid: vaani-py-no-plain-http
httpx.get("http://example.org/api")
# ok: vaani-py-no-plain-http
httpx.get("http://localhost:4000/api")
# ok: vaani-py-no-plain-http
httpx.get("https://example.org/api")
