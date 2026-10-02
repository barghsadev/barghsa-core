export class UploadXHR {
  static instances: UploadXHR[] = [];
  status = 0;
  withCredentials = true;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: Blob | null = null;
  aborted = false;
  upload = { onprogress: null as null | ((event: { loaded: number }) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  onabort: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  constructor() {
    UploadXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: Blob) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number) {
    this.upload.onprogress?.({ loaded });
  }
  complete(status = 200) {
    this.status = status;
    this.onload?.();
  }
}
