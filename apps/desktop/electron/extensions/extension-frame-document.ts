/** The app owns the bridge; an extension contributes only its prebuilt mount module. */
export function extensionFrameDocument(input: {
  readonly connectionId: string;
  readonly frontendUrl: string;
  readonly bridgeUrl: string;
  readonly nonce: string;
  readonly mode?: "view" | "editor";
}): string {
  if (input.mode === "editor") return editorFrameDocument(input);
  const literal = (value: string) => JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;min-height:100%;font:13px system-ui}body{background:var(--background);color:var(--foreground)}#root{min-height:100vh}.host-error{padding:16px;white-space:pre-wrap}</style>
</head><body><div id="root" role="main"></div>
<script type="module" nonce="${input.nonce}">
import { createChordClientConnection, parseDesktopHostAction } from ${literal(input.bridgeUrl)};
import { mount } from ${literal(input.frontendUrl)};
const connectionId = ${literal(input.connectionId)};
let connected = false;
window.addEventListener('message', async (event) => {
  if (connected || event.source !== parent || event.data?.type !== 'pi-garden:extension-connect' || event.data.connectionId !== connectionId || event.ports.length !== 1) return;
  connected = true;
  const port = event.ports[0];
  const root = document.getElementById('root');
  const pending = new Map();
  const theme = event.data.theme;
  const themeListeners = new Set();
  const toolListeners = new Set();
  let toolState = event.data.tool ?? null;
  const notifyTheme = () => { for (const listener of themeListeners) listener(theme); };
  const notifyTool = () => { if (toolState) for (const listener of toolListeners) listener(toolState); };
  const applyTheme = (next) => {
    Object.assign(theme, next);
    if (next.snapshot) theme.snapshot = next.snapshot;
    document.documentElement.dataset.themeId = theme.snapshot && theme.snapshot.id || '';
    document.documentElement.style.colorScheme = theme.mode;
    for (const name of ['background', 'foreground', 'accent']) document.documentElement.style.setProperty('--' + name, theme[name]);
    document.documentElement.style.setProperty('--bg', theme.background);
    document.documentElement.style.setProperty('--fg', theme.foreground);
    const tokens = theme.snapshot && theme.snapshot.tokens;
    if (tokens) {
      for (const name of Object.keys(tokens)) document.documentElement.style.setProperty(name, tokens[name]);
    }
    notifyTheme();
  };
  let sequence = 0;
  let dispose;
  const showError = (error) => {
    root.className = 'host-error';
    root.textContent = error instanceof Error ? error.message : String(error);
    port.postMessage({type:'pi-garden:frame-error',message:root.textContent});
  };
  const connection = createChordClientConnection({send: message => port.postMessage(message),onError:showError});
  const action = (input) => new Promise((resolve,reject) => {
    if (connection.signal.aborted) { reject(new Error('This view is closed')); return; }
    if (pending.size >= 32) { reject(new Error('Too many pending desktop actions')); return; }
    let value;
    try { value = parseDesktopHostAction(input); } catch (error) { reject(error); return; }
    const requestId = 'host-' + (++sequence);
    pending.set(requestId,{resolve,reject});
    port.postMessage({type:'host-action',requestId,action:value});
  });
  connection.signal.addEventListener('abort', () => {
    for (const request of pending.values()) request.reject(new Error('This view is closed'));
    pending.clear();
    if (dispose) Promise.resolve().then(dispose).catch(showError);
  }, {once:true});
  port.onmessage = ({data}) => {
    if (data?.type === 'pi-garden:theme-changed') { applyTheme(data.theme); return; }
    if (data?.type === 'pi-garden:tool-state') { toolState = data.tool ?? null; notifyTool(); return; }
    if (data?.type === 'host-action-result') {
      const request = pending.get(data.requestId);
      if (!request) return;
      pending.delete(data.requestId);
      if (data.ok === true) request.resolve(data.result);
      else request.reject(new Error(typeof data.error === 'string' ? data.error : 'The action could not be completed'));
    } else connection.receive(data);
  };
  port.onmessageerror = () => connection.close('Invalid frame message');
  port.start();
  applyTheme(theme);
  try {
    if (typeof mount !== 'function') throw new Error('The extension frontend must export mount(root, host).');
    dispose = await mount(root,{services:connection.services,signal:connection.signal,theme,tool:toolState,subscribeTool(listener){toolListeners.add(listener); if (toolState) listener(toolState); return () => toolListeners.delete(listener);},subscribeTheme(listener){themeListeners.add(listener); listener(theme); return () => themeListeners.delete(listener);},actions:{
      openFile: target => action({type:'openFile',...target}),
      prepareTaskDraft: draft => action({type:'prepareTaskDraft',...draft}),
      presentOverlay: id => action({type:'presentOverlay',id}),
      settle: value => action(value === undefined ? {type:'settleOverlay'} : {type:'settleOverlay',value}),
      cancel: () => action({type:'cancelOverlay'})
    }});
    if (typeof dispose !== 'function') throw new Error('The extension mount must return a cleanup function.');
    if (connection.signal.aborted) await dispose();
    else port.postMessage({type:'pi-garden:frame-ready'});
  } catch (error) { showError(error); connection.close('Extension mount failed'); }
}, {once:false});
</script></body></html>`;
}

function editorFrameDocument(input: {
  readonly connectionId: string;
  readonly frontendUrl: string;
  readonly bridgeUrl: string;
  readonly nonce: string;
}): string {
  const literal = (value: string) => JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;font:13px system-ui}body{background:var(--background);color:var(--foreground)}#root{height:100%}.host-error{padding:8px;white-space:pre-wrap}</style>
</head><body><div id="root" role="textbox" aria-multiline="true"></div>
<script type="module" nonce="${input.nonce}">
import { createChordClientConnection } from ${literal(input.bridgeUrl)};
import { mount } from ${literal(input.frontendUrl)};
const connectionId = ${literal(input.connectionId)};
let connected = false;
const keyId = (event) => {
  const parts = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('super');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  parts.push(key);
  return parts.join('+');
};
window.addEventListener('message', async (event) => {
  if (connected || event.source !== parent || event.data?.type !== 'pi-garden:extension-connect' || event.data.connectionId !== connectionId || event.ports.length !== 1) return;
  connected = true;
  const port = event.ports[0];
  const root = document.getElementById('root');
  const pending = new Map();
  const textListeners = new Set();
  const cursorListeners = new Set();
  const stateListeners = new Set();
  const themeListeners = new Set();
  const theme = event.data.theme;
  let text = typeof event.data.text === 'string' ? event.data.text : '';
  let cursor = text.length;
  let state = event.data.editorState && event.data.editorState.status === 'running' ? {status:'running'} : {status:'idle'};
  let shortcuts = new Set(Array.isArray(event.data.shortcuts) ? event.data.shortcuts : []);
  let menuOpen = event.data.menuOpen === true;
  let applyingHost = false;
  let sequence = 0;
  let dispose;
  const notifyText = () => { for (const listener of textListeners) listener(text); };
  const notifyCursor = () => { for (const listener of cursorListeners) listener(cursor); };
  const notifyState = () => { for (const listener of stateListeners) listener(state); };
  const notifyTheme = () => { for (const listener of themeListeners) listener(theme); };
  const showError = (error) => {
    root.className = 'host-error';
    root.textContent = error instanceof Error ? error.message : String(error);
    port.postMessage({type:'pi-garden:frame-error',message:root.textContent});
  };
  const applyTheme = (next) => {
    Object.assign(theme, next);
    if (next.snapshot) theme.snapshot = next.snapshot;
    document.documentElement.dataset.themeId = theme.snapshot && theme.snapshot.id || '';
    document.documentElement.style.colorScheme = theme.mode;
    for (const name of ['background', 'foreground', 'accent']) document.documentElement.style.setProperty('--' + name, theme[name]);
    document.documentElement.style.setProperty('--bg', theme.background);
    document.documentElement.style.setProperty('--fg', theme.foreground);
    const tokens = theme.snapshot && theme.snapshot.tokens;
    if (tokens) for (const name of Object.keys(tokens)) document.documentElement.style.setProperty(name, tokens[name]);
    notifyTheme();
  };
  const publishText = (next, nextCursor) => {
    text = typeof next === 'string' ? next : '';
    cursor = Number.isInteger(nextCursor) ? Math.max(0, Math.min(nextCursor, text.length)) : text.length;
    if (!applyingHost) port.postMessage({type:'pi-garden:editor-text', text, cursor});
    notifyText();
    notifyCursor();
  };
  const request = (type, payload, signal) => new Promise((resolve, reject) => {
    if (connection.signal.aborted) { reject(new Error('This editor is closed')); return; }
    const requestId = 'editor-' + (++sequence);
    const finish = (error) => { pending.delete(requestId); reject(error); };
    if (signal) {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      signal.addEventListener('abort', () => finish(new DOMException('Aborted', 'AbortError')), {once:true});
    }
    pending.set(requestId, {resolve, reject});
    port.postMessage({type, requestId, ...payload});
  });
  const connection = createChordClientConnection({send: message => port.postMessage(message), onError: showError});
  const host = {
    getText: () => text,
    setText: (next, nextCursor) => publishText(next, nextCursor),
    subscribeText(listener) { textListeners.add(listener); return () => textListeners.delete(listener); },
    getCursor: () => cursor,
    subscribeCursor(listener) { cursorListeners.add(listener); listener(cursor); return () => cursorListeners.delete(listener); },
    state,
    subscribeState(listener) { stateListeners.add(listener); listener(state); return () => stateListeners.delete(listener); },
    requestFocus: () => port.postMessage({type:'pi-garden:editor-focus-request'}),
    submit: (intent) => port.postMessage({type:'pi-garden:editor-submit', shift: intent && intent.shift === true, meta: intent && intent.meta === true, ctrl: intent && intent.ctrl === true, composing: intent && intent.composing === true}),
    autocomplete: {
      request: (query, signal) => request('pi-garden:editor-query', {text: query.text, cursor: query.cursor, force: query.force === true}, signal),
      apply: (input) => request('pi-garden:editor-apply', {text: input.text, cursor: input.cursor, prefix: input.prefix, item: input.item})
    },
    theme,
    subscribeTheme(listener) { themeListeners.add(listener); listener(theme); return () => themeListeners.delete(listener); },
    signal: connection.signal,
    services: connection.services
  };
  window.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const id = keyId(event);
    const editing = event.key.length === 1 && 'acvxz'.includes(event.key.toLowerCase()) && !event.shiftKey && !event.altKey;
    if ((event.metaKey || event.ctrlKey || event.altKey) && !editing) {
      event.preventDefault();
      port.postMessage({type:'pi-garden:editor-shortcut', id, key: event.key, code: event.code, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey});
      return;
    }
    if (shortcuts.has(id)) {
      event.preventDefault();
      port.postMessage({type:'pi-garden:editor-shortcut', id, key: event.key, code: event.code, shift: event.shiftKey, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey});
    }
  });
  // Host suggestion menus own navigation keys while open, and Tab always asks the host
  // for a forced completion. These are taken in the capture phase so the frontend never
  // sees them as editing keys.
  window.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return;
    const menuKey = menuOpen && ['ArrowUp','ArrowDown','Tab','Enter','Escape'].includes(event.key);
    const forceKey = event.key === 'Tab' && !event.shiftKey;
    if (!menuKey && !forceKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    port.postMessage({type:'pi-garden:editor-menu-key', key: event.key, shift: event.shiftKey});
  }, true);
  window.addEventListener('error', (event) => {
    showError(event.error instanceof Error ? event.error : new Error(event.message || 'The editor crashed.'));
    connection.close('Editor crashed');
  });
  window.addEventListener('unhandledrejection', (event) => {
    showError(event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? 'The editor crashed.')));
    connection.close('Editor crashed');
  });
  const postFiles = async (fileList) => {
    const files = [...fileList].slice(0, 8);
    if (files.length === 0) return;
    const payload = [];
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      payload.push({name: file.name, type: file.type, data: btoa(binary)});
    }
    if (payload.length > 0) port.postMessage({type:'pi-garden:editor-files', files: payload});
  };
  window.addEventListener('paste', (event) => {
    if (event.clipboardData && event.clipboardData.files.length > 0) {
      event.preventDefault();
      postFiles(event.clipboardData.files).catch(showError);
    }
  });
  window.addEventListener('drop', (event) => {
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      event.preventDefault();
      postFiles(event.dataTransfer.files).catch(showError);
    }
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  connection.signal.addEventListener('abort', () => {
    for (const request of pending.values()) request.reject(new Error('This editor is closed'));
    pending.clear();
    if (dispose) Promise.resolve().then(dispose).catch(showError);
  }, {once:true});
  port.onmessage = ({data}) => {
    if (data?.type === 'pi-garden:theme-changed') { applyTheme(data.theme); return; }
    if (data?.type === 'pi-garden:editor-text') {
      applyingHost = true;
      publishText(data.text, data.cursor);
      applyingHost = false;
      return;
    }
    if (data?.type === 'pi-garden:editor-state') {
      state = data.status === 'running' ? {status:'running'} : {status:'idle'};
      host.state = state;
      notifyState();
      return;
    }
    if (data?.type === 'pi-garden:editor-focus') {
      const target = root.querySelector('[data-editor-focus]') || root.querySelector('textarea,input,[contenteditable="true"]') || root;
      if (target && target.focus) target.focus();
      return;
    }
    if (data?.type === 'pi-garden:editor-shortcuts') {
      shortcuts = new Set(Array.isArray(data.shortcuts) ? data.shortcuts : []);
      menuOpen = data.menuOpen === true;
      return;
    }
    if (data?.type === 'pi-garden:editor-result') {
      const request = pending.get(data.requestId);
      if (!request) return;
      pending.delete(data.requestId);
      if (data.ok === true) request.resolve(data.result);
      else request.reject(new Error(typeof data.error === 'string' ? data.error : 'Editor request failed'));
      return;
    }
    connection.receive(data);
  };
  port.onmessageerror = () => connection.close('Invalid frame message');
  port.start();
  applyTheme(theme);
  try {
    if (typeof mount !== 'function') throw new Error('The editor frontend must export mount(root, host).');
    dispose = await mount(root, host);
    if (typeof dispose !== 'function') throw new Error('The editor mount must return a cleanup function.');
    if (connection.signal.aborted) await dispose();
    else port.postMessage({type:'pi-garden:frame-ready'});
  } catch (error) { showError(error); connection.close('Editor mount failed'); }
}, {once:false});
</script></body></html>`;
}
