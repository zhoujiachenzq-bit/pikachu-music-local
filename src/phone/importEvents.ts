// EventSource replacement for the in-WebView backend: no network SSE connection.
export class ImportEvents {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(url: string) {
    const jobUrl = url.replace(/\/events$/, '');
    const poll = async () => {
      try {
        const response = await fetch(jobUrl);
        if (!response.ok) throw new Error('无法读取导入进度');
        const { job } = await response.json();
        if (!job || typeof job.status !== 'string') throw new Error('导入进度无效');
        if (this.closed) return;
        this.onmessage?.({ data: JSON.stringify(job) });
        if (['completed', 'partial', 'failed'].includes(job.status)) this.close();
        else if (!this.closed) this.timer = setTimeout(poll, 500);
      } catch {
        if (!this.closed) { this.close(); this.onerror?.(); }
      }
    };
    this.timer = setTimeout(poll, 0);
  }

  close() { this.closed = true; clearTimeout(this.timer); }
}
