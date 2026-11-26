"""Initialize only the dedicated new volume directory, then discard root privileges."""
import os
from pathlib import Path
import stat

directory = Path('/data/broker')
if os.environ.get('BROKER_STORAGE_DIRECTORY') != str(directory):
    raise RuntimeError('Dedicated /data/broker storage required')
if directory.parent.is_symlink() or directory.is_symlink():
    raise RuntimeError('Storage symlinks are not allowed')
os.umask(0o077)
directory.mkdir(mode=0o700, exist_ok=True)
info = directory.stat()
if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, 10001):
    raise RuntimeError('Unexpected storage owner')
if os.getuid() == 0:
    # No recursive ownership changes; never mount an existing project volume here.
    os.chown(directory, 10001, 10001)
    os.chmod(directory, 0o700)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
if os.getuid() != 10001 or os.getgid() != 10001:
    raise RuntimeError('Broker must run unprivileged')
os.execv('/usr/local/bin/python', ['python', '/app/broker.py'])
