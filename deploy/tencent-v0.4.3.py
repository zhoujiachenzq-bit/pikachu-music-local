#!/usr/bin/env python3
"""Run as root from the v0.4.3 checkout. Never prints container environment values."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import time
import urllib.request

VERSION = 'v0.4.3'
APP = 'zqmusic-app'
DATA = Path('/opt/zqmusic-data')
DB = DATA / 'pikachu-music.sqlite'
REPO = Path(__file__).resolve().parent.parent
STAMP = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
BACKUP = Path('/opt/zqmusic-backups') / f'{VERSION}-{STAMP}'
IMAGE = f'zqmusic:{VERSION}'
CANDIDATE = f'zqmusic-candidate-v043-{STAMP}'
ROLLBACK = f'{APP}-rollback-{STAMP}'
EXPECTED_CACHE = 'pikachu-music-shell-v0.4.3-r1'


def run(*args, capture=False):
    result = subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def inspect(name):
    return json.loads(run('docker', 'inspect', name, capture=True))[0]


def snapshot(destination):
    with sqlite3.connect(f'file:{DB}?mode=ro', uri=True) as source:
        with sqlite3.connect(destination) as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise RuntimeError('SQLite backup integrity failed')
    destination.chmod(0o600)
    print(f'SQLite backup verified: {destination}', flush=True)


def counts():
    with sqlite3.connect(f'file:{DB}?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Production database integrity failed')
        return {table: connection.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
                for table in ('users', 'favorites', 'playlists', 'agent_messages')}


def get(url):
    with urllib.request.urlopen(url, timeout=8) as response:
        return response.read(2_000_000).decode('utf-8')


def verify(base, container=None):
    last = None
    for _ in range(40):
        try:
            if json.loads(get(base + '/api/health')).get('ok') is not True:
                raise RuntimeError('Health check failed')
            if EXPECTED_CACHE not in get(base + '/sw.js'):
                raise RuntimeError('Unexpected service worker version')
            html = get(base + '/')
            import re
            assets = re.findall(r'(?:src|href)=["\'](/assets/[^"\']+)["\']', html)
            if not assets:
                raise RuntimeError('Missing frontend assets')
            for asset in assets:
                if '<!doctype html' in get(base + asset)[:100].lower():
                    raise RuntimeError('Asset served HTML')
            if container and run('docker', 'exec', container, 'node', '-p',
                                 'require("./package.json").version', capture=True) != VERSION[1:]:
                raise RuntimeError('Unexpected application version')
            return
        except Exception as error:
            last = error
            time.sleep(2)
    raise RuntimeError(f'Verification failed for {base}') from last


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo python3 deploy/tencent-v0.4.3.py')
    os.umask(0o077)
    for executable in ('docker', 'git'):
        if not shutil.which(executable):
            raise RuntimeError(f'Missing {executable}')
    if run('git', '-C', str(REPO), 'describe', '--tags', '--exact-match', capture=True) != VERSION:
        raise RuntimeError('Checkout must be the exact release tag')
    run('git', '-C', str(REPO), 'diff', '--exit-code')
    old = inspect(APP)
    if not old['State']['Running'] or not DB.is_file():
        raise RuntimeError('Current application or database is unavailable')
    mounts = old['Mounts']
    if len(mounts) != 1 or mounts[0]['Type'] != 'bind' or mounts[0]['Source'] != str(DATA) or mounts[0]['Destination'] != '/var/data':
        raise RuntimeError('Unexpected data mounts; review before deploying')
    ports = old['HostConfig']['PortBindings']
    if ports != {'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '3000'}]}:
        raise RuntimeError('Unexpected published ports; review before deploying')
    networks = list(old['NetworkSettings']['Networks'])
    if not networks:
        raise RuntimeError('No application networks found')
    print(json.dumps({'oldImage': old['Config']['Image'], 'networks': networks,
                      'dataMount': str(DATA), 'version': VERSION}), flush=True)
    before = counts()
    run('docker', 'build', '--tag', IMAGE, str(REPO))
    BACKUP.mkdir(parents=True, mode=0o700, exist_ok=False)
    BACKUP.parent.chmod(0o700)
    env = old['Config']['Env']
    if any('\n' in value or '\r' in value for value in env):
        raise RuntimeError('Multiline environment requires manual review')
    env_file = BACKUP / 'container.env'
    env_file.write_text('\n'.join(env) + '\n', encoding='utf-8')
    env_file.chmod(0o600)
    if (DATA / 'agent.env').is_file():
        shutil.copyfile(DATA / 'agent.env', BACKUP / 'agent.env')
        (BACKUP / 'agent.env').chmod(0o600)
    snapshot(BACKUP / 'before-candidate.sqlite')
    candidate_data = BACKUP / 'candidate-data'
    candidate_data.mkdir(mode=0o700)
    shutil.copyfile(BACKUP / 'before-candidate.sqlite', candidate_data / DB.name)
    # The image runs as Node uid/gid 1000; this is an isolated database copy.
    os.chown(candidate_data, 1000, 1000)
    os.chown(candidate_data / DB.name, 1000, 1000)

    def start(name, data, port):
        args = ['docker', 'run', '-d', '--name', name, '--restart', 'unless-stopped',
                '--init', '--stop-timeout', '20', '--publish', f'127.0.0.1:{port}:3000',
                '--mount', f'type=bind,src={data},dst=/var/data', '--env-file', str(env_file),
                '--network', networks[0], '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
                '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--pids-limit', '200',
                '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3', '--label', f'cn.zqmusic.release={VERSION}']
        memory = old['HostConfig'].get('Memory', 0)
        if memory:
            args += ['--memory', str(memory)]
        memory_swap = old['HostConfig'].get('MemorySwap', 0)
        if memory_swap:
            args += ['--memory-swap', str(memory_swap)]
        cpus = old['HostConfig'].get('NanoCpus', 0)
        if cpus:
            args += ['--cpus', str(cpus / 1_000_000_000)]
        run(*args, IMAGE)
        for network in networks[1:]:
            run('docker', 'network', 'connect', network, name)

    try:
        start(CANDIDATE, candidate_data, 3001)
        verify('http://127.0.0.1:3001', CANDIDATE)
    finally:
        # The unique name belongs exclusively to this run; never remove another service.
        subprocess.run(['docker', 'rm', '-f', CANDIDATE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.chown(candidate_data, 0, 0)
    print('Candidate verified against database copy; beginning cutover', flush=True)
    stopped = renamed = new_created = False
    try:
        run('docker', 'stop', APP)
        stopped = True
        snapshot(BACKUP / 'before-cutover.sqlite')
        before = counts()
        run('docker', 'rename', APP, ROLLBACK)
        renamed = True
        # Name ownership transfers to this run after the old container is renamed.
        new_created = True
        start(APP, DATA, 3000)
        verify('http://127.0.0.1:3000', APP)
        if counts() != before:
            raise RuntimeError('Core data counts changed during cutover')
        verify('https://zqmusic.cn')
    except Exception:
        if new_created:
            subprocess.run(['docker', 'rm', '-f', APP], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if renamed:
            run('docker', 'rename', ROLLBACK, APP)
        if stopped:
            run('docker', 'start', APP)
        print('Deployment failed; previous container restored. Database snapshots retained.', flush=True)
        raise
    print(json.dumps({'deployed': VERSION, 'rollback': ROLLBACK, 'backup': str(BACKUP),
                      'counts': before, 'publicVerified': True}), flush=True)


if __name__ == '__main__':
    main()
