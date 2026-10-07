#!/usr/bin/env python3
"""Owned, bounded descriptor-relative Detox evidence publisher.

The TypeScript caller owns this process and retains its PID/start/reap facts.
This sidecar never changes cwd, uses one opened 0700 root descriptor, and
publishes through Darwin renameatx_np(RENAME_EXCL) or Linux
renameat2(RENAME_NOREPLACE). Cleanup uses one bounded rename-to-recovery
attempt; if inode ownership is uncertain the recovery name is retained for
inspection instead of retrying a check-then-delete loop.
"""
import base64
import ctypes
import errno
import hashlib
import json
import os
import re
import stat
import sys
import uuid

libc = ctypes.CDLL(None, use_errno=True)
libc.openat.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
libc.openat.restype = ctypes.c_int
if hasattr(libc, "renameatx_np"):
    libc.renameatx_np.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    libc.renameatx_np.restype = ctypes.c_int
if hasattr(libc, "renameat2"):
    libc.renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    libc.renameat2.restype = ctypes.c_int

READ_CHUNK = 64 * 1024
MAX_PAYLOAD = 8 * 1024 * 1024
MAX_FRAME = 16 * 1024 * 1024
MAX_SOURCE = 2 * 1024 * 1024
MAX_ERROR = 256
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:private\.)?(?:json|xml|png)$")
RENAME_EXCL = 0x00000004
RENAME_NOREPLACE = 0x00000001


def bounded_text(value):
    return str(value).replace("\r", " ").replace("\n", " ").replace("\t", " ")[:MAX_ERROR]


def emit(value):
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode()
    if len(encoded) + 1 > MAX_FRAME:
        raise RuntimeError("sidecar response exceeds frame bound")
    sys.stdout.buffer.write(encoded + b"\n")
    sys.stdout.buffer.flush()


def read_line(limit):
    line = sys.stdin.buffer.readline(limit + 1)
    if not line:
        raise RuntimeError("control channel closed")
    if len(line) > limit and not line.endswith(b"\n"):
        raise RuntimeError("control frame exceeds bound")
    try:
        return json.loads(line.decode("utf-8"))
    except Exception as error:
        raise RuntimeError("control frame is not valid JSON") from error


def receive_resume():
    value = read_line(1024)
    if value.get("abort"):
        raise RuntimeError(bounded_text(value.get("reason") or "writer aborted"))
    if value.get("continue") is not True:
        raise RuntimeError("resume channel did not continue")


def receive_outer_ack():
    value = read_line(4096)
    if value.get("outerAck") is True:
        return True, ""
    if value.get("outerAbort") is True:
        return False, bounded_text(value.get("reason") or "outer readback aborted")
    raise RuntimeError("outer readback acknowledgement was not explicit")


def errno_message(operation):
    return f"{operation}: {os.strerror(ctypes.get_errno())}"


def metadata(value):
    return {
        "dev": value.st_dev,
        "ino": value.st_ino,
        "uid": value.st_uid,
        "gid": value.st_gid,
        "mode": value.st_mode,
        "nlink": value.st_nlink,
        "size": value.st_size,
        "mtimeMs": value.st_mtime_ns / 1_000_000,
        "ctimeMs": value.st_ctime_ns / 1_000_000,
    }


def same_inode(left, right):
    return (
        left["dev"] == right["dev"]
        and left["ino"] == right["ino"]
        and left["uid"] == right["uid"]
        and left["gid"] == right["gid"]
        and left["mode"] == right["mode"]
        and left["size"] == right["size"]
    )


def same_created_inode(left, right):
    return (
        left["dev"] == right["dev"]
        and left["ino"] == right["ino"]
        and left["uid"] == right["uid"]
        and left["gid"] == right["gid"]
    )


def same_identity(left, right):
    return same_inode(left, right) and left["nlink"] == right["nlink"]


def atomic_noreplace_rename(root_fd, temporary_name, final_name):
    """Rename one owned temporary entry without replacing an existing final.

    The normal publication path must not create a temporary hardlink and then
    unlink that link: an unlink is a separate check/remove boundary that can
    be raced by a replacement. Darwin's renameatx_np(RENAME_EXCL) and Linux's
    renameat2(RENAME_NOREPLACE) provide the required descriptor-relative,
    no-replace operation. If the platform does not expose either primitive,
    fail closed instead of falling back to an overwriting rename or a
    linkat+unlink sequence.
    """
    temporary = temporary_name.encode()
    final = final_name.encode()
    if hasattr(libc, "renameatx_np"):
        result = libc.renameatx_np(
            root_fd,
            temporary,
            root_fd,
            final,
            RENAME_EXCL,
        )
    elif hasattr(libc, "renameat2"):
        result = libc.renameat2(
            root_fd,
            temporary,
            root_fd,
            final,
            RENAME_NOREPLACE,
        )
    else:
        raise OSError(errno.ENOTSUP, "descriptor-relative no-replace rename is unavailable")
    if result != 0:
        error_number = ctypes.get_errno()
        raise OSError(error_number, errno_message("no-replace publication rename"))
    return "renameatx_np(RENAME_EXCL)" if hasattr(libc, "renameatx_np") else "renameat2(RENAME_NOREPLACE)"


def require_private_root_fd(fd):
    value = os.fstat(fd)
    mode = stat.S_IMODE(value.st_mode)
    if not stat.S_ISDIR(value.st_mode) or mode != 0o700 or value.st_uid != os.getuid():
        raise RuntimeError("opened root is not an owned 0700 directory")
    return metadata(value)


def same_root_identity(left, right):
    return (
        left["dev"] == right["dev"]
        and left["ino"] == right["ino"]
        and left["uid"] == right["uid"]
        and left["gid"] == right["gid"]
        and left["mode"] == right["mode"]
    )


def path_root_matches(root, expected):
    try:
        value = os.lstat(root)
    except OSError:
        return False
    actual = metadata(value)
    return (
        stat.S_ISDIR(value.st_mode)
        and not stat.S_ISLNK(value.st_mode)
        and same_root_identity(actual, expected)
    )


def relative_stat(root_fd, name):
    try:
        value = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        return None
    return metadata(value)


def bounded_recovery_remove(root_fd, name, expected, pause_before_unlink=False, target_name=None):
    """Remove one owned link with a single recovery rename.

    POSIX has no inode compare-and-delete primitive. We therefore do one
    descriptor-relative ownership check, move the checked entry to a fresh
    recovery name, and recheck that moved inode. POSIX has no atomic
    inode-compare-and-delete primitive, so the rechecked recovery inode is
    deliberately retained as actionable evidence. Any mismatch or syscall
    uncertainty also retains the recovery entry. There are no retry loops.
    """
    actual = relative_stat(root_fd, name)
    if actual is None:
        return {"status": "absent", "method": "bounded-quarantine-once"}
    if not same_inode(actual, expected) or actual["nlink"] != expected["nlink"]:
        return {
            "status": "ownership-lost",
            "actual": actual,
            "method": "bounded-quarantine-once",
            "atomicConditionalRemoval": False,
        }
    if not hasattr(libc, "renameatx_np") and not hasattr(libc, "renameat2"):
        return {
            "status": "ownership-unavailable",
            "recoveryName": name,
            "method": "bounded-quarantine-once",
            "atomicConditionalRemoval": False,
        }
    recovery_name = f".recovery-{os.getpid()}-{uuid.uuid4().hex}"
    try:
        atomic_noreplace_rename(root_fd, name, recovery_name)
    except OSError as error:
        return {
            "status": "failed",
            "error": bounded_text(error),
            "recoveryName": name,
            "method": "bounded-quarantine-once",
        }
    quarantined = relative_stat(root_fd, recovery_name)
    if (
        quarantined is None
        or not same_inode(quarantined, expected)
        or quarantined["nlink"] != expected["nlink"]
    ):
        return {
            "status": "ownership-lost",
            "actual": quarantined,
            "recoveryName": recovery_name,
            "method": "bounded-quarantine-once",
            "atomicConditionalRemoval": False,
        }
    if pause_before_unlink:
        emit({
            "type": "before-recovery-unlink",
            "target": target_name or name,
            "recoveryName": recovery_name,
        })
        receive_resume()
        after_pause = relative_stat(root_fd, recovery_name)
        if (
            after_pause is None
            or not same_inode(after_pause, expected)
            or after_pause["nlink"] != expected["nlink"]
        ):
            return {
                "status": "ownership-lost",
                "actual": after_pause,
                "recoveryName": recovery_name,
                "method": "bounded-quarantine-once",
                "atomicConditionalRemoval": False,
                "recovery": "retained",
            }
    return {
        "status": "retained",
        "recoveryName": recovery_name,
        "method": "bounded-quarantine-once",
        "atomicConditionalRemoval": False,
        "recovery": "retained-no-conditional-unlink",
    }


def verify_source_pin(pin):
    if not isinstance(pin, dict):
        raise RuntimeError("missing sidecar source pin")
    source = pin.get("path")
    expected_hash = pin.get("sha256")
    expected_bytes = pin.get("bytes")
    if not isinstance(source, str) or not os.path.isabs(source) or not isinstance(expected_hash, str):
        raise RuntimeError("invalid sidecar source pin")
    canonical = os.path.realpath(source)
    if canonical != source:
        raise RuntimeError("sidecar source path is not canonical")
    value = os.lstat(source)
    if not stat.S_ISREG(value.st_mode) or stat.S_ISLNK(value.st_mode) or stat.S_IMODE(value.st_mode) & 0o022:
        raise RuntimeError("sidecar source is not private")
    if value.st_uid != os.getuid() or value.st_size <= 0 or value.st_size > MAX_SOURCE:
        raise RuntimeError("sidecar source is not bounded and owned")
    digest = hashlib.sha256()
    total = 0
    with open(source, "rb", buffering=0) as handle:
        while True:
            chunk = handle.read(READ_CHUNK)
            if not chunk:
                break
            total += len(chunk)
            digest.update(chunk)
            if total > MAX_SOURCE:
                raise RuntimeError("sidecar source exceeds bound")
    if total != value.st_size or total != expected_bytes or digest.hexdigest() != expected_hash:
        raise RuntimeError("sidecar source pin changed")
    return {"path": source, "sha256": digest.hexdigest(), "bytes": total}


def decode_payload(request):
    encoded = request.get("payloadBase64")
    max_bytes = request.get("maxBytes")
    if not isinstance(encoded, str) or not isinstance(max_bytes, int) or max_bytes <= 0 or max_bytes > MAX_FRAME:
        raise RuntimeError("payload bound is invalid")
    if len(encoded) > ((max_bytes + 2) // 3) * 4 + 4:
        raise RuntimeError("encoded payload exceeds bound")
    try:
        payload = base64.b64decode(encoded, validate=True)
    except Exception as error:
        raise RuntimeError("payload encoding is invalid") from error
    if not payload or len(payload) > max_bytes or len(payload) > MAX_PAYLOAD:
        raise RuntimeError("payload is empty or exceeds bound")
    return payload, max_bytes


def close_fd(fd):
    if fd is not None:
        try:
            os.close(fd)
        except OSError:
            pass


def fail(stage, error, cleanup=None):
    emit({"type": "error", "stage": stage, "error": bounded_text(error), "cleanup": cleanup or []})


def publish(request):
    root = os.path.abspath(request.get("root", ""))
    name = request.get("name")
    if not isinstance(name, str) or not NAME_RE.fullmatch(name):
        raise RuntimeError("unsafe publication filename")
    payload, max_bytes = decode_payload(request)
    source_pin = verify_source_pin(request.get("sourcePin"))
    root_fd = None
    temp_fd = None
    final_fd = None
    temp_name = None
    temp_identity = None
    final_identity = None
    cleanup = []
    try:
        root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        root_identity = require_private_root_fd(root_fd)
        expected_root = request.get("expectedRootIdentity")
        if expected_root is not None and not same_root_identity(root_identity, expected_root):
            raise RuntimeError("opened root identity did not match preflight")
        emit({"type": "opened", "rootIdentity": root_identity, "sourcePin": source_pin})
        if request.get("pauseAfterOpen"):
            receive_resume()
        if not path_root_matches(root, root_identity):
            raise RuntimeError("root path changed after descriptor open")
        temp_name = f".tmp-{os.getpid()}-{uuid.uuid4().hex}"
        temp_fd = libc.openat(
            root_fd,
            temp_name.encode(),
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
        )
        if temp_fd < 0:
            raise OSError(ctypes.get_errno(), errno_message("openat temporary"))
        # Record the inode immediately after openat, before fchmod/write/fsync.
        created_identity = metadata(os.fstat(temp_fd))
        if (
            not stat.S_ISREG(created_identity["mode"])
            or created_identity["nlink"] != 1
            or created_identity["uid"] != os.getuid()
        ):
            raise RuntimeError("temporary inode is not a regular owned inode")
        os.fchmod(temp_fd, 0o600)
        temp_identity = metadata(os.fstat(temp_fd))
        if (
            not same_created_inode(created_identity, temp_identity)
            or temp_identity["nlink"] != 1
            or stat.S_IMODE(temp_identity["mode"]) != 0o600
            or temp_identity["uid"] != os.getuid()
        ):
            raise RuntimeError("temporary inode changed or is not private and owned")
        offset = 0
        while offset < len(payload):
            count = os.write(temp_fd, payload[offset : offset + READ_CHUNK])
            if count <= 0:
                raise RuntimeError("temporary write made no progress")
            offset += count
        os.fsync(temp_fd)
        descriptor_after_write = metadata(os.fstat(temp_fd))
        if not same_created_inode(descriptor_after_write, temp_identity):
            raise RuntimeError("temporary descriptor changed while writing")
        if descriptor_after_write["size"] != len(payload):
            raise RuntimeError("temporary size changed while writing")
        temp_identity = descriptor_after_write
        if not path_root_matches(root, root_identity):
            raise RuntimeError("root path changed before publication")
        path_temp = relative_stat(root_fd, temp_name)
        if path_temp is None or not same_identity(path_temp, temp_identity):
            raise RuntimeError("temporary path identity changed before publication")
        emit({"type": "temp-ready", "tempName": temp_name, "tempIdentity": temp_identity, "sourcePin": source_pin})
        if request.get("pauseAtTempReady"):
            receive_resume()
        if not path_root_matches(root, root_identity):
            raise RuntimeError("root path changed at publication boundary")
        path_temp = relative_stat(root_fd, temp_name)
        if path_temp is None or not same_identity(path_temp, temp_identity):
            cleanup.append({"target": "temporary", "result": {"status": "ownership-lost", "actual": path_temp}})
            raise RuntimeError("temporary ownership was lost before publication")
        try:
            publication_method = atomic_noreplace_rename(root_fd, temp_name, name)
        except OSError as error:
            if error.errno == errno.EEXIST:
                cleanup.append({"target": "temporary", "result": bounded_recovery_remove(root_fd, temp_name, temp_identity, bool(request.get("pauseBeforeRecoveryUnlink")), "temporary")})
                raise FileExistsError(errno.EEXIST, "destination already exists", name)
            raise
        final_identity = relative_stat(root_fd, name)
        if final_identity is None or final_identity["nlink"] != 1 or not same_inode(final_identity, temp_identity):
            raise RuntimeError("published inode did not match temporary inode")
        emit({"type": "published", "tempName": temp_name, "finalName": name, "finalIdentity": final_identity, "publicationMethod": publication_method, "sourcePin": source_pin})
        if request.get("pauseAtPublished"):
            receive_resume()
        if not path_root_matches(root, root_identity):
            raise RuntimeError("root path changed after publication")
        final_identity_after = relative_stat(root_fd, name)
        if final_identity_after is None or final_identity_after["nlink"] != 1 or not same_inode(final_identity_after, temp_identity):
            cleanup.append({"target": "final", "result": {"status": "ownership-lost", "actual": final_identity_after}})
            raise RuntimeError("final inode changed after temporary cleanup")
        final_fd = libc.openat(root_fd, name.encode(), os.O_RDONLY | os.O_NOFOLLOW, 0)
        if final_fd < 0:
            raise OSError(ctypes.get_errno(), errno_message("openat final readback"))
        final_stat = metadata(os.fstat(final_fd))
        if not same_inode(final_stat, final_identity_after):
            raise RuntimeError("final descriptor identity changed during readback")
        chunks = []
        total = 0
        while True:
            chunk = os.read(final_fd, READ_CHUNK)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError("final readback exceeded bound")
            chunks.append(chunk)
        actual = b"".join(chunks)
        if actual != payload:
            raise RuntimeError("final bytes failed descriptor readback")
        close_fd(final_fd)
        final_fd = None
        if not path_root_matches(root, root_identity):
            raise RuntimeError("root path changed after final readback")
        emit({
            "type": "result",
            "bytesBase64": base64.b64encode(payload).decode(),
            "metadata": final_stat,
            "finalIdentity": final_stat,
            "publicationMethod": publication_method,
            "sourcePin": source_pin,
        })
        if request.get("awaitOuterAck"):
            acknowledged, reason = receive_outer_ack()
            if not acknowledged:
                cleanup.append({"target": "final", "result": bounded_recovery_remove(root_fd, name, final_identity_after, bool(request.get("pauseBeforeRecoveryUnlink")), "final")})
                emit({"type": "outer-recovery", "cleanup": cleanup, "stage": "outer-readback", "sourcePin": source_pin})
                raise RuntimeError(reason)
    except Exception as error:
        close_fd(final_fd)
        final_fd = None
        close_fd(temp_fd)
        temp_fd = None
        if root_fd is not None and temp_name is not None:
            current = relative_stat(root_fd, temp_name)
            if current is not None and temp_identity is not None and same_inode(current, temp_identity) and current["nlink"] == temp_identity["nlink"]:
                cleanup.append({"target": "temporary", "result": bounded_recovery_remove(root_fd, temp_name, temp_identity, bool(request.get("pauseBeforeRecoveryUnlink")), "temporary")})
            elif current is not None:
                cleanup.append({"target": "temporary", "result": {"status": "ownership-lost", "actual": current, "recovery": "retained"}})
            elif temp_identity is None:
                cleanup.append({"target": "temporary", "result": {"status": "ownership-unproven", "name": temp_name, "recovery": "retained"}})
        if root_fd is not None and final_identity is not None:
            current = relative_stat(root_fd, name)
            if current is not None and same_inode(current, final_identity) and current["nlink"] == final_identity["nlink"]:
                cleanup.append({"target": "final", "result": bounded_recovery_remove(root_fd, name, final_identity, bool(request.get("pauseBeforeRecoveryUnlink")), "final")})
            elif current is not None:
                cleanup.append({"target": "final", "result": {"status": "ownership-lost", "actual": current, "recovery": "retained"}})
        fail("publish", error, cleanup)
    finally:
        close_fd(final_fd)
        close_fd(temp_fd)
        close_fd(root_fd)


def main():
    line = sys.stdin.buffer.readline(MAX_FRAME + 1)
    if not line:
        return 2
    if len(line) > MAX_FRAME and not line.endswith(b"\n"):
        fail("startup", "request frame exceeds bound")
        return 1
    try:
        request = json.loads(line.decode("utf-8"))
        if request.get("op") != "publish":
            raise RuntimeError("unsupported operation")
        publish(request)
        return 0
    except Exception as error:
        fail("startup", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
