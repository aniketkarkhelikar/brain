#!/usr/bin/env python3
"""
remote_exec.py — Run commands on lab52 via SSH (paramiko) and stream output back.

Usage:
    python3 remote_exec.py "ls -la"
    python3 remote_exec.py "cd ~/workspace/ai_second_brain && ls"
    python3 remote_exec.py --test
    python3 remote_exec.py --upload local_file.txt /remote/path/
    python3 remote_exec.py --download /remote/path/file.txt local_dest/

Environment overrides:
    LAB52_HOST  (default: 172.25.128.20)
    LAB52_USER  (default: lab52)
    LAB52_PASS  (default: ragserver)
    LAB52_WORK  (default: ~/workspace/ai_second_brain)
"""

import paramiko
import sys
import os
import argparse
import stat
import time

# ── Defaults ──────────────────────────────────────────────────────────
DEFAULT_HOST = os.environ.get("LAB52_HOST", "172.25.128.20")
DEFAULT_USER = os.environ.get("LAB52_USER", "lab52")
DEFAULT_PASS = os.environ.get("LAB52_PASS", "ragserver")
DEFAULT_WORK = os.environ.get("LAB52_WORK", "~/workspace/ai_second_brain")
LOCAL_WORK   = os.path.dirname(os.path.abspath(__file__))


def get_ssh_client(host=DEFAULT_HOST, user=DEFAULT_USER, password=DEFAULT_PASS):
    """Create and return a connected SSH client."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username=user, password=password, timeout=15)
    return client


def run_remote(command, user=DEFAULT_USER, host=DEFAULT_HOST,
               password=DEFAULT_PASS, workdir=DEFAULT_WORK):
    """Execute a command on the remote machine and stream output."""
    full_cmd = f"cd {workdir} 2>/dev/null; {command}"

    print(f"┌─ REMOTE ({user}@{host}) ──────────────────────────────────")
    print(f"│  cmd: {command}")
    print(f"│  cwd: {workdir}")
    print(f"├──────────────────────────────────────────────────────────")

    client = get_ssh_client(host, user, password)
    try:
        stdin, stdout, stderr = client.exec_command(full_cmd, timeout=300)
        # Read combined output
        output_lines = []
        for line in stdout:
            stripped = line.rstrip("\n")
            print(f"│  {stripped}")
            output_lines.append(stripped)
        
        err_lines = stderr.read().decode().strip()
        if err_lines:
            for line in err_lines.split("\n"):
                print(f"│  [stderr] {line}")
                output_lines.append(f"[stderr] {line}")

        exit_code = stdout.channel.recv_exit_status()
    finally:
        client.close()

    print(f"├──────────────────────────────────────────────────────────")
    print(f"│  exit code: {exit_code}")
    print(f"└──────────────────────────────────────────────────────────")

    return exit_code, "\n".join(output_lines)


def upload_file(local_path, remote_path, user=DEFAULT_USER, host=DEFAULT_HOST,
                password=DEFAULT_PASS):
    """Upload a file to the remote machine via SFTP."""
    print(f"⬆  Uploading {local_path} → {user}@{host}:{remote_path}")
    client = get_ssh_client(host, user, password)
    try:
        sftp = client.open_sftp()
        if os.path.isdir(local_path):
            _upload_dir(sftp, local_path, remote_path)
        else:
            # Ensure remote directory exists
            remote_dir = os.path.dirname(remote_path)
            _mkdir_p(sftp, remote_dir)
            sftp.put(local_path, remote_path)
        sftp.close()
        print(f"✓  Upload complete")
        return 0
    except Exception as e:
        print(f"✗  Upload failed: {e}")
        return 1
    finally:
        client.close()


def download_file(remote_path, local_path, user=DEFAULT_USER, host=DEFAULT_HOST,
                  password=DEFAULT_PASS):
    """Download a file from the remote machine via SFTP."""
    print(f"⬇  Downloading {user}@{host}:{remote_path} → {local_path}")
    client = get_ssh_client(host, user, password)
    try:
        sftp = client.open_sftp()
        # Ensure local directory exists
        local_dir = os.path.dirname(local_path) if not os.path.isdir(local_path) else local_path
        os.makedirs(local_dir, exist_ok=True)
        
        try:
            file_stat = sftp.stat(remote_path)
            if stat.S_ISDIR(file_stat.st_mode):
                _download_dir(sftp, remote_path, local_path)
            else:
                if os.path.isdir(local_path):
                    local_path = os.path.join(local_path, os.path.basename(remote_path))
                sftp.get(remote_path, local_path)
        except IOError:
            sftp.get(remote_path, local_path)
        
        sftp.close()
        print(f"✓  Download complete")
        return 0
    except Exception as e:
        print(f"✗  Download failed: {e}")
        return 1
    finally:
        client.close()


def _mkdir_p(sftp, remote_dir):
    """Recursively create remote directories."""
    if not remote_dir or remote_dir == "/":
        return
    try:
        sftp.stat(remote_dir)
    except IOError:
        _mkdir_p(sftp, os.path.dirname(remote_dir))
        try:
            sftp.mkdir(remote_dir)
        except IOError:
            pass


def _upload_dir(sftp, local_dir, remote_dir):
    """Recursively upload a directory."""
    _mkdir_p(sftp, remote_dir)
    skip_dirs = {".git", "node_modules", "target", "__pycache__", ".venv", "venv"}
    for item in os.listdir(local_dir):
        if item in skip_dirs:
            continue
        local_item = os.path.join(local_dir, item)
        remote_item = os.path.join(remote_dir, item)
        if os.path.isdir(local_item):
            _upload_dir(sftp, local_item, remote_item)
        else:
            sftp.put(local_item, remote_item)
            print(f"│  ⬆ {remote_item}")


def _download_dir(sftp, remote_dir, local_dir):
    """Recursively download a directory."""
    os.makedirs(local_dir, exist_ok=True)
    for item in sftp.listdir_attr(remote_dir):
        remote_item = os.path.join(remote_dir, item.filename)
        local_item = os.path.join(local_dir, item.filename)
        if stat.S_ISDIR(item.st_mode):
            _download_dir(sftp, remote_item, local_item)
        else:
            sftp.get(remote_item, local_item)


def test_connection(user=DEFAULT_USER, host=DEFAULT_HOST, password=DEFAULT_PASS):
    """Test SSH connectivity and print remote system info."""
    print("🔌 Testing SSH connection to lab52...")
    code, output = run_remote(
        " && ".join([
            "echo '=== Connected ==='",
            "uname -a",
            "echo '--- Python ---'",
            "python3 --version",
            "echo '--- Disk ---'",
            "df -h ~ | tail -1",
            "echo '--- RAM ---'",
            "free -h | head -2",
            "echo '--- GPU ---'",
            "(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo 'No NVIDIA GPU detected')",
            "echo '--- Ollama ---'",
            "(ollama --version 2>/dev/null || echo 'Ollama not installed')",
            "echo '--- Workspace ---'",
            "ls -la ~/workspace/ai_second_brain/ 2>/dev/null || echo 'Workspace dir does not exist yet'",
        ]),
        user=user, host=host, password=password, workdir="~"
    )
    return code


def setup_workspace(user=DEFAULT_USER, host=DEFAULT_HOST, password=DEFAULT_PASS,
                    workdir=DEFAULT_WORK):
    """Ensure the remote workspace directory exists."""
    print("📁 Setting up remote workspace...")
    code, _ = run_remote(
        f"mkdir -p {workdir}",
        user=user, host=host, password=password, workdir="~"
    )
    return code


def main():
    parser = argparse.ArgumentParser(
        description="Execute commands on lab52 remote server via SSH (paramiko)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    group = parser.add_mutually_exclusive_group()
    group.add_argument("command", nargs="?", help="Shell command to run remotely")
    group.add_argument("--test", action="store_true",
                       help="Test SSH connection and show remote system info")
    group.add_argument("--setup", action="store_true",
                       help="Create the remote workspace directory")
    group.add_argument("--upload", nargs=2, metavar=("LOCAL", "REMOTE"),
                       help="Upload file/dir to remote")
    group.add_argument("--download", nargs=2, metavar=("REMOTE", "LOCAL"),
                       help="Download file/dir from remote")

    parser.add_argument("--host", default=DEFAULT_HOST,
                        help=f"Remote host (default: {DEFAULT_HOST})")
    parser.add_argument("--user", default=DEFAULT_USER,
                        help=f"Remote user (default: {DEFAULT_USER})")
    parser.add_argument("--password", default=DEFAULT_PASS,
                        help="SSH password")
    parser.add_argument("--workdir", default=DEFAULT_WORK,
                        help=f"Remote workdir (default: {DEFAULT_WORK})")

    args = parser.parse_args()

    try:
        if args.test:
            sys.exit(test_connection(args.user, args.host, args.password))
        elif args.setup:
            sys.exit(setup_workspace(args.user, args.host, args.password, args.workdir))
        elif args.upload:
            sys.exit(upload_file(args.upload[0], args.upload[1],
                                args.user, args.host, args.password))
        elif args.download:
            sys.exit(download_file(args.download[0], args.download[1],
                                   args.user, args.host, args.password))
        elif args.command:
            code, _ = run_remote(args.command, args.user, args.host,
                                 args.password, args.workdir)
            sys.exit(code)
        else:
            parser.print_help()
            sys.exit(1)
    except paramiko.AuthenticationException:
        print(f"✗  Authentication failed for {args.user}@{args.host}")
        sys.exit(1)
    except paramiko.SSHException as e:
        print(f"✗  SSH error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"✗  Connection error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
