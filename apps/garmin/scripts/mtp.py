"""USB access to a Garmin watch over MTP, using the kalam library that ships with OpenMTP.

  python3 -I mtp.py info               model name, part number, firmware from GARMIN/(Garmin)Device.xml
  python3 -I mtp.py push <file> <dir>  copy a file to the watch, e.g. into /GARMIN/APPS

Never prints the serial number or device ID. The local copy of the device file is deleted after reading.
macOS: the photo service ptpcamerad may hold the watch; close OpenMTP, Garmin Express and Photos first.
"""

import ctypes
import json
import os
import shutil
import sys
import tempfile
import threading
import xml.etree.ElementTree as ET

KALAM = os.environ.get(
    "KALAM_LIB", "/Applications/OpenMTP.app/Contents/Resources/bin/arm64/kalam.dylib"
)
TIMEOUT_S = 120
CALLBACK = ctypes.CFUNCTYPE(None, ctypes.c_char_p)


class MtpError(Exception):
    pass


class Kalam:
    def __init__(self, path):
        if not os.path.exists(path):
            raise MtpError(f"MTP-Bibliothek fehlt ({path}). OpenMTP installieren.")
        self.lib = ctypes.CDLL(path)
        self._callbacks = []

    def call(self, name, *payloads, progress_callbacks=0):
        done = threading.Event()
        box = {}

        def on_done(raw):
            box["raw"] = raw.decode("utf-8", "replace") if raw else ""
            done.set()

        def ignore(_raw):
            pass

        callbacks = [CALLBACK(ignore) for _ in range(progress_callbacks)] + [CALLBACK(on_done)]
        self._callbacks.extend(callbacks)
        args = [ctypes.c_char_p(json.dumps(p).encode()) for p in payloads]
        getattr(self.lib, name)(*args, *callbacks)
        if not done.wait(TIMEOUT_S):
            raise MtpError(f"{name}: keine Antwort von der Uhr")
        result = json.loads(box["raw"]) if box["raw"] else {}
        if isinstance(result, dict) and result.get("error"):
            raise MtpError(f"{name}: {result.get('errorType', '')} {result['error']}".strip())
        return result.get("data") if isinstance(result, dict) else result


def storage_ids(kalam):
    ids = []
    for storage in kalam.call("FetchStorages") or []:
        candidates = [storage] + [v for v in storage.values() if isinstance(v, dict)]
        for c in candidates:
            sid = next((v for k, v in c.items() if "id" in k.lower() and isinstance(v, int)), None)
            if sid is not None:
                ids.append(sid)
                break
    if not ids:
        raise MtpError("Kein Speicher auf der Uhr gefunden")
    return ids


def transfer(kalam, function, sid, sources, destination):
    kalam.call(
        function,
        {
            "storageId": sid,
            "sources": sources,
            "destination": destination,
            "preprocessFiles": False,
        },
        progress_callbacks=2,
    )


def mtp_device_info(kalam):
    """Model and firmware as the watch reports them over MTP. Serial is never read out."""
    raw = kalam.call("FetchDeviceInfo") or {}
    info = raw.get("mtpDeviceInfo", raw) if isinstance(raw, dict) else {}
    pick = lambda *keys: next((str(info[k]) for k in keys if info.get(k)), "")
    return {"model": pick("Model", "model"), "software": pick("DeviceVersion", "deviceVersion")}


def list_garmin_folder(kalam, sid):
    entries = kalam.call(
        "Walk",
        {
            "storageId": sid,
            "fullPath": "/GARMIN",
            "recursive": False,
            "skipDisallowedFiles": False,
            "skipHiddenFiles": False,
        },
    )
    return {e.get("name") for e in entries or []}


def device_info(kalam):
    """Reads the device file. Newer watches (e.g. Forerunner 255) call it GarminDevice.xml."""
    workdir = tempfile.mkdtemp(prefix="arnold-devxml-")
    try:
        for sid in storage_ids(kalam):
            names = list_garmin_folder(kalam, sid)
            name = next((n for n in ("GarminDevice.xml", "Device.xml") if n in names), None)
            if not name:
                continue
            transfer(kalam, "DownloadFiles", sid, [f"/GARMIN/{name}"], workdir)
            path = os.path.join(workdir, name)
            if os.path.exists(path):
                return parse_device_xml(path)
        raise MtpError("GARMIN/GarminDevice.xml bzw. GARMIN/Device.xml nicht gefunden")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def parse_device_xml(path):
    root = ET.parse(path).getroot()
    ns = root.tag[1:].split("}")[0] if root.tag.startswith("{") else ""

    def text(node, tag):
        found = node.find(f"{{{ns}}}{tag}" if ns else tag) if node is not None else None
        return (found.text or "").strip() if found is not None else ""

    model = root.find(f"{{{ns}}}Model" if ns else "Model")
    return {
        "model": text(model, "Description"),
        "part_number": text(model, "PartNumber"),
        "software": text(model, "SoftwareVersion"),
    }


def main(argv):
    if len(argv) < 2 or argv[1] not in ("info", "push"):
        print(__doc__.strip())
        return 2
    kalam = Kalam(KALAM)
    kalam.call("Initialize")
    try:
        if argv[1] == "info":
            usb = mtp_device_info(kalam)
            print(f"USB-Modell: {usb['model']}")
            print(f"USB-Firmware: {usb['software']}")
            info = device_info(kalam)
            print(f"Modell: {info['model']}")
            print(f"Teilenummer: {info['part_number']}")
            print(f"Firmware: {info['software']}")
        else:
            if len(argv) != 4:
                print("push <datei> <zielordner>")
                return 2
            source = os.path.abspath(argv[2])
            if not os.path.isfile(source):
                raise MtpError(f"Datei fehlt: {source}")
            transfer(kalam, "UploadFiles", storage_ids(kalam)[0], [source], argv[3])
            print(f"Kopiert: {os.path.basename(source)} -> {argv[3]}")
        return 0
    finally:
        kalam.call("Dispose")


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except MtpError as e:
        print(f"Fehler: {e}", file=sys.stderr)
        sys.exit(1)
