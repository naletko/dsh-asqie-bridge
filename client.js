// Browser half of dsh-asqie-bridge: the plugin's configuration page.
//
// All values are stored on the Host in $DSH_HOME/asqie-bridge.json through
// /api/asqie-bridge/config. The token is never returned to the browser in
// clear text; only a has-token flag and a short hint are exposed.
window.__ModuleLoader__.load({
  id: 'dsh-asqie-bridge',
  factory(require) {
    const React = require('react');
    const { createElement: h, useCallback, useEffect, useState } = React;

    const STATUS_META = {
      online: { label: 'Online', tone: 'ok' },
      connecting: { label: 'Connecting…', tone: 'wait' },
      starting: { label: 'Starting…', tone: 'wait' },
      unconfigured: { label: 'Not configured', tone: 'idle' },
      error: { label: 'Connection problem', tone: 'err' },
    };

    const STYLES = `
      .dsh-asqie-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        max-width: 640px;
        padding: 4px 0 18px;
        color: var(--dsw-alias-label-primary, #e8e8ea);
        font-size: 13px;
        line-height: 1.45;
      }
      .dsh-asqie-hero {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border: 1px solid var(--dsw-alias-line-1, rgba(255,255,255,.12));
        border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.04));
      }
      .dsh-asqie-hero-mark {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(145deg, #6b9bf7, #4a5fd6);
        color: #fff;
      }
      .dsh-asqie-hero-text { flex: 1; min-width: 0; }
      .dsh-asqie-hero-title { font-weight: 600; font-size: 14px; }
      .dsh-asqie-hero-sub { color: var(--dsw-alias-label-tertiary, #8b95a8); font-size: 12px; margin-top: 2px; }
      .dsh-asqie-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }
      .dsh-asqie-pill::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .dsh-asqie-pill.ok { color: #3ddc97; background: rgba(61,220,151,.12); }
      .dsh-asqie-pill.wait { color: #f0b429; background: rgba(240,180,41,.12); }
      .dsh-asqie-pill.idle { color: #9aa4b6; background: rgba(154,164,182,.12); }
      .dsh-asqie-pill.err { color: #ff6b6b; background: rgba(255,107,107,.12); }
      .dsh-asqie-field { display: flex; flex-direction: column; gap: 6px; }
      .dsh-asqie-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .dsh-asqie-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary, #c7cedb); }
      .dsh-asqie-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8b95a8); }
      .dsh-asqie-input,
      .dsh-asqie-select {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid var(--dsw-alias-line-1, rgba(255,255,255,.14));
        background: var(--dsw-alias-bg-layer-1, rgba(0,0,0,.18));
        color: var(--dsw-alias-label-primary, #e8e8ea);
        font: inherit;
        outline: none;
        transition: border-color .15s, box-shadow .15s;
      }
      .dsh-asqie-input:focus { border-color: var(--dsw-alias-state-business-primary, #4a7cf0); box-shadow: 0 0 0 3px rgba(74,124,240,.16); }
      .dsh-asqie-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      @media (max-width: 560px) { .dsh-asqie-row { grid-template-columns: 1fr; } }
      .dsh-asqie-link {
        border: none;
        background: none;
        color: var(--dsw-alias-state-business-primary, #6b9bf7);
        font: inherit;
        font-size: 12px;
        cursor: pointer;
        padding: 0;
      }
      .dsh-asqie-toggle {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--dsw-alias-line-1, rgba(255,255,255,.12));
        background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.03));
      }
      .dsh-asqie-toggle input { margin-top: 2px; width: 16px; height: 16px; accent-color: #4a7cf0; }
      .dsh-asqie-toggle-text { min-width: 0; }
      .dsh-asqie-toggle-title { font-weight: 600; font-size: 12px; }
      .dsh-asqie-toggle-sub { color: var(--dsw-alias-label-tertiary, #8b95a8); font-size: 11px; margin-top: 2px; }
      .dsh-asqie-actions { display: flex; align-items: center; gap: 10px; padding-top: 2px; }
      .dsh-asqie-btn {
        border-radius: 8px;
        padding: 8px 14px;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid var(--dsw-alias-line-1, rgba(255,255,255,.14));
        background: var(--dsw-alias-bg-layer-2, rgba(255,255,255,.06));
        color: var(--dsw-alias-label-primary, #e8e8ea);
      }
      .dsh-asqie-btn.primary {
        border-color: transparent;
        background: linear-gradient(145deg, #6b9bf7, #4a5fd6);
        color: #fff;
      }
      .dsh-asqie-btn:disabled { opacity: .55; cursor: default; }
      .dsh-asqie-status { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8b95a8); }
      .dsh-asqie-status.err { color: #ff8080; }
      .dsh-asqie-status.ok { color: #4cd7a0; }
      .dsh-asqie-note {
        border-left: 3px solid var(--dsw-alias-state-business-primary, #4a7cf0);
        padding: 8px 12px;
        border-radius: 0 8px 8px 0;
        background: var(--dsw-alias-bg-layer-2, rgba(74,124,240,.08));
        color: var(--dsw-alias-label-secondary, #c7cedb);
        font-size: 11px;
      }
      .dsh-asqie-note code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10.5px;
        background: rgba(0,0,0,.25);
        padding: 1px 4px;
        border-radius: 4px;
      }
    `;

    function Mark() {
      return h('svg', { viewBox: '0 0 64 64', width: 22, height: 22, 'aria-hidden': 'true' },
        h('rect', { x: 4, y: 4, width: 56, height: 56, rx: 15, fill: 'none' }),
        h('rect', { x: 21, y: 13, width: 22, height: 38, rx: 7, fill: '#fff' }),
        h('rect', { x: 25, y: 18, width: 14, height: 24, rx: 3, fill: '#3c52cf' }),
        h('path', { d: 'M29 24l5 4.5-5 4.5', fill: 'none', stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M29 35h5', stroke: '#8ef1dd', strokeWidth: 2.4, strokeLinecap: 'round' }),
        h('path', { d: 'M15 27c-4 3-4 8 0 11M49 27c4 3 4 8 0 11', fill: 'none', stroke: '#fff', strokeWidth: 3.2, strokeLinecap: 'round', opacity: '.9' })
      );
    }

    function BridgeSettings() {
      const [draft, setDraft] = useState({
        apiUrl: 'https://api.asqie.pro/api/v1',
        agentToken: '',
        machineName: '',
        agentName: 'DeepSeek Harness',
        autoApprove: true,
      });
      const [config, setConfig] = useState(null);
      const [status, setStatus] = useState(null);
      const [showToken, setShowToken] = useState(false);
      const [saving, setSaving] = useState(false);
      const [message, setMessage] = useState('');
      const [messageTone, setMessageTone] = useState('');

      const load = useCallback(async () => {
        try {
          const response = await fetch('/api/asqie-bridge/config', { headers: { Accept: 'application/json' } });
          const data = await response.json();
          if (!data || !data.ok) throw new Error((data && data.error) || 'Could not read the bridge settings');
          setConfig(data.config);
          setStatus(data.status);
          setDraft((current) => ({
            ...current,
            apiUrl: data.config.apiUrl || current.apiUrl,
            machineName: data.config.machineName || current.machineName,
            agentName: data.config.agentName || current.agentName,
            autoApprove: data.config.autoApprove !== false,
            agentToken: '',
          }));
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
          setMessageTone('err');
        }
      }, []);

      useEffect(() => {
        void load();
      }, [load]);

      useEffect(() => {
        const timer = setInterval(async () => {
          try {
            const response = await fetch('/api/asqie-bridge/status', { headers: { Accept: 'application/json' } });
            const data = await response.json();
            if (data && data.ok) setStatus(data.status);
          } catch {
            // keep the last known status
          }
        }, 5000);
        return () => clearInterval(timer);
      }, []);

      const save = useCallback(async () => {
        setSaving(true);
        setMessage('');
        setMessageTone('');
        try {
          const response = await fetch('/api/asqie-bridge/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              apiUrl: draft.apiUrl,
              agentToken: draft.agentToken,
              machineName: draft.machineName,
              agentName: draft.agentName,
              autoApprove: draft.autoApprove,
            }),
          });
          const data = await response.json();
          if (!data || !data.ok) throw new Error((data && data.error) || 'Save failed');
          setConfig(data.config);
          setStatus(data.status);
          setDraft((current) => ({ ...current, agentToken: '' }));
          const connected = data.status && data.status.agentId
            ? `Saved · connected as agent #${data.status.agentId}`
            : data.status && data.status.state === 'unconfigured'
              ? 'Saved · paste an agent token to connect'
              : 'Saved';
          setMessage(connected);
          setMessageTone(data.status && data.status.state === 'error' ? 'err' : 'ok');
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
          setMessageTone('err');
        } finally {
          setSaving(false);
        }
      }, [draft]);

      const effectiveStatus = status && status.state
        ? STATUS_META[status.state] || STATUS_META.error
        : STATUS_META.idle;
      const connected = status && status.agentId;

      return h('div', { className: 'dsh-asqie-form' },
        h('style', null, STYLES),
        h('div', { className: 'dsh-asqie-hero' },
          h('div', { className: 'dsh-asqie-hero-mark' }, h(Mark)),
          h('div', { className: 'dsh-asqie-hero-text' },
            h('div', { className: 'dsh-asqie-hero-title' }, 'Time Asqie Bridge'),
            h('div', { className: 'dsh-asqie-hero-sub' },
              connected
                ? `Agent #${status.agentId} · ${draft.machineName || config?.machineName || 'this machine'}`
                : 'Control this DeepSeek Harness from your phone — prompts, live output, questions and permissions.'
            )
          ),
          h('span', { className: `dsh-asqie-pill ${effectiveStatus.tone}` }, effectiveStatus.label)
        ),

        h('div', { className: 'dsh-asqie-field' },
          h('label', { className: 'dsh-asqie-label' }, 'Time Asqie API URL'),
          h('input', {
            className: 'dsh-asqie-input',
            type: 'url',
            spellCheck: false,
            value: draft.apiUrl,
            placeholder: 'https://api.asqie.pro/api/v1',
            onChange: (event) => setDraft({ ...draft, apiUrl: event.target.value }),
          }),
          h('span', { className: 'dsh-asqie-hint' }, 'Usually https://api.asqie.pro/api/v1 — keep the /api/v1 suffix.')
        ),

        h('div', { className: 'dsh-asqie-field' },
          h('div', { className: 'dsh-asqie-field-head' },
            h('label', { className: 'dsh-asqie-label' }, 'Agent token'),
            h('button', { type: 'button', className: 'dsh-asqie-link', onClick: () => setShowToken(!showToken) },
              showToken ? 'Hide' : 'Show')
          ),
          h('input', {
            className: 'dsh-asqie-input',
            type: showToken ? 'text' : 'password',
            spellCheck: false,
            autoComplete: 'off',
            value: draft.agentToken,
            placeholder: config && config.hasToken ? `Saved (${config.tokenHint}) — leave blank to keep` : 'asq_…',
            onChange: (event) => setDraft({ ...draft, agentToken: event.target.value }),
          }),
          h('span', { className: 'dsh-asqie-hint' },
            'Create the agent in Time Asqie → Coding Agents → Add agent, then paste its token here. It is stored on this machine only.'
          )
        ),

        h('div', { className: 'dsh-asqie-row' },
          h('div', { className: 'dsh-asqie-field' },
            h('label', { className: 'dsh-asqie-label' }, 'Machine name'),
            h('input', {
              className: 'dsh-asqie-input',
              type: 'text',
              spellCheck: false,
              value: draft.machineName,
              placeholder: 'alex-macbook',
              onChange: (event) => setDraft({ ...draft, machineName: event.target.value }),
            }),
            h('span', { className: 'dsh-asqie-hint' }, 'Stable id for this computer.')
          ),
          h('div', { className: 'dsh-asqie-field' },
            h('label', { className: 'dsh-asqie-label' }, 'Agent name'),
            h('input', {
              className: 'dsh-asqie-input',
              type: 'text',
              spellCheck: false,
              value: draft.agentName,
              placeholder: 'DeepSeek Harness',
              onChange: (event) => setDraft({ ...draft, agentName: event.target.value }),
            }),
            h('span', { className: 'dsh-asqie-hint' }, 'Shown in Time Asqie.')
          )
        ),

        h('div', { className: 'dsh-asqie-toggle' },
          h('input', {
            type: 'checkbox',
            checked: draft.autoApprove,
            onChange: (event) => setDraft({ ...draft, autoApprove: event.target.checked }),
          }),
          h('div', { className: 'dsh-asqie-toggle-text' },
            h('div', { className: 'dsh-asqie-toggle-title' }, 'Auto-approve tool permissions'),
            h('div', { className: 'dsh-asqie-toggle-sub' },
              'Run Bash and other tool actions without a phone prompt. Questions with options are still shown. '
              + 'The agent setting in Time Asqie can override this value on the next heartbeat.'
            )
          )
        ),

        h('div', { className: 'dsh-asqie-actions' },
          h('button', { className: 'dsh-asqie-btn primary', onClick: save, disabled: saving },
            saving ? 'Saving…' : 'Save and connect'),
          h('button', { className: 'dsh-asqie-btn', onClick: () => void load(), disabled: saving }, 'Reload'),
          message && h('span', { className: `dsh-asqie-status ${messageTone}` }, message)
        ),

        status && status.lastError && h('div', { className: 'dsh-asqie-status err' }, status.lastError),

        h('div', { className: 'dsh-asqie-note' },
          'The bridge works while DeepSeek Harness is running. Settings are stored in ',
          h('code', null, '$DSH_HOME/asqie-bridge.json'),
          ' on this machine; the token is never sent back to the interface.'
        )
      );
    }

    function BridgeSettingsSlot({ view }) {
      if (view === 'summary') {
        return 'Connect this machine to Time Asqie: API URL, agent token, auto-approve.';
      }
      return h(BridgeSettings);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-asqie-bridge',
        }, BridgeSettingsSlot));

        ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: 'dsh-asqie-bridge#asqie-bridge',
        }, BridgeSettingsSlot));
      }
    };
  }
});
