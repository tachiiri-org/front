import type { DbApplyComponent } from '../../../../schema/component/kind/db-apply';
import { ALL_CSS_PROP_KEYS } from '../../../../schema/component/style';

const C = {
  bg: '#0f172a',
  surface: '#1e293b',
  border: '#334155',
  text: '#cbd5e1',
  textBright: '#f1f5f9',
  textDim: '#64748b',
  accent: '#3b82f6',
  hoverBg: '#1e3a5f',
  selectedBg: '#1e3a8a',
  expandColor: '#86efac',
  contractColor: '#fca5a5',
  contractDim: '#4b2929',
  appliedDim: '#475569',
  warningBg: '#1c1009',
};

function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles?: Partial<CSSStyleDeclaration>,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (styles) Object.assign(e.style, styles);
  return e;
}

type DbApplyStatus = {
  label: string;
  applied: string[];
  pendingExpand: string[];
  pendingContract: string[];
  tableExists: boolean;
};

type StatusResponse = {
  identity: DbApplyStatus;
  userDbs: DbApplyStatus[];
};

type FilesResponse = { expand: string[]; contract: string[] };
type FileResponse = { name: string; sql: string };

export const renderDbApply = (
  id: string,
  component: DbApplyComponent,
): HTMLElement => {
  const root = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    background: C.bg,
    color: C.text,
    fontFamily: 'monospace',
    fontSize: '13px',
    boxSizing: 'border-box',
    overflow: 'hidden',
  });
  root.dataset.frameId = id;

  for (const propKey of ALL_CSS_PROP_KEYS) {
    const v = (component as Record<string, unknown>)[propKey];
    if (typeof v === 'string') (root.style as unknown as Record<string, string>)[propKey] = v;
  }

  // ================================================================
  // Tab bar
  // ================================================================
  const tabBar = styled('div', {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '6px 12px 0',
    background: C.surface,
    borderBottom: `1px solid ${C.border}`,
    flexShrink: '0',
  });

  const makeTab = (label: string): HTMLButtonElement => {
    const btn = styled('button', {
      padding: '4px 16px',
      fontSize: '12px',
      fontFamily: 'monospace',
      cursor: 'pointer',
      border: 'none',
      borderRadius: '4px 4px 0 0',
      background: 'transparent',
      color: C.textDim,
    });
    btn.textContent = label;
    return btn;
  };

  const identityTab = makeTab('Identity');
  const userDbTab = makeTab('User DB');

  const tabSpacer = styled('div', { flex: '1' });

  const connectLink = styled('a', {
    fontSize: '11px',
    color: C.accent,
    textDecoration: 'none',
    marginRight: '12px',
    alignSelf: 'center',
    paddingBottom: '4px',
  });
  connectLink.href = `/oauth/github/connect/start?returnTo=${encodeURIComponent(window.location.pathname)}`;
  connectLink.textContent = 'GitHub Connect';

  const ciDeployBtn = styled('button', {
    padding: '3px 10px',
    fontSize: '11px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    border: `1px solid ${C.border}`,
    borderRadius: '3px',
    background: C.surface,
    color: C.textBright,
    marginBottom: '4px',
    alignSelf: 'center',
  });
  ciDeployBtn.textContent = 'CI Deploy (stage→main)';

  const runMigrateBtn = styled('button', {
    padding: '3px 10px',
    fontSize: '11px',
    fontFamily: 'monospace',
    cursor: 'pointer',
    border: `1px solid ${C.border}`,
    borderRadius: '3px',
    background: C.surface,
    color: C.textBright,
    marginBottom: '4px',
    marginLeft: '4px',
    alignSelf: 'center',
  });
  runMigrateBtn.textContent = 'Run Migration Runner';

  tabBar.append(identityTab, userDbTab, tabSpacer, connectLink, ciDeployBtn, runMigrateBtn);
  root.appendChild(tabBar);

  // ================================================================
  // CI log panel (hidden by default)
  // ================================================================
  const ciLog = styled('div', {
    display: 'none',
    padding: '6px 12px',
    background: '#0a0a0a',
    borderBottom: `1px solid ${C.border}`,
    maxHeight: '120px',
    overflowY: 'auto',
    flexShrink: '0',
    fontSize: '11px',
    fontFamily: 'monospace',
    color: '#d4d4d4',
  });
  root.appendChild(ciLog);

  const logLine = (msg: string, isErr = false): void => {
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const line = styled('div');
    line.textContent = `[${ts}] ${msg}`;
    line.style.color = isErr ? '#f87171' : '#d4d4d4';
    ciLog.appendChild(line);
    ciLog.scrollTop = ciLog.scrollHeight;
    ciLog.style.display = '';
  };

  // ================================================================
  // Body
  // ================================================================
  const body = styled('div', {
    display: 'flex',
    flex: '1',
    minHeight: '0',
    overflow: 'hidden',
  });
  root.appendChild(body);

  // ================================================================
  // Sidebar
  // ================================================================
  const sidebar = styled('div', {
    width: '260px',
    flexShrink: '0',
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${C.border}`,
    background: C.surface,
    overflow: 'hidden',
  });

  const sidebarTop = styled('div', {
    padding: '8px',
    flexShrink: '0',
    borderBottom: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  });

  // User DB selector (hidden by default)
  const userSelect = styled('select', {
    width: '100%',
    background: C.bg,
    color: C.text,
    border: `1px solid ${C.border}`,
    padding: '4px 6px',
    fontSize: '12px',
    fontFamily: 'monospace',
    borderRadius: '3px',
    cursor: 'pointer',
    boxSizing: 'border-box',
    display: 'none',
  });
  sidebarTop.appendChild(userSelect);

  // Action buttons row
  const actionRow = styled('div', {
    display: 'flex',
    gap: '4px',
    flexWrap: 'wrap',
  });

  const makeActionBtn = (text: string, color: string): HTMLButtonElement => {
    const btn = styled('button', {
      flex: '1',
      padding: '3px 6px',
      fontSize: '11px',
      fontFamily: 'monospace',
      cursor: 'pointer',
      border: `1px solid ${color}`,
      borderRadius: '3px',
      background: 'transparent',
      color,
    });
    btn.textContent = text;
    return btn;
  };

  const applyExpandBtn = makeActionBtn('Apply Expand', C.expandColor);
  const applyContractBtn = makeActionBtn('Apply Contract', C.contractColor);
  const reloadBtn = makeActionBtn('Reload', C.textDim);
  actionRow.append(applyExpandBtn, applyContractBtn, reloadBtn);
  sidebarTop.appendChild(actionRow);
  sidebar.appendChild(sidebarTop);

  const sidebarList = styled('div', {
    flex: '1',
    overflowY: 'auto',
    padding: '4px 0',
  });
  sidebar.appendChild(sidebarList);
  body.appendChild(sidebar);

  // ================================================================
  // Main
  // ================================================================
  const main = styled('div', {
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: C.bg,
  });

  const mainHeader = styled('div', {
    padding: '5px 12px',
    flexShrink: '0',
    borderBottom: `1px solid ${C.border}`,
    background: C.surface,
    color: C.textDim,
    fontSize: '11px',
    minHeight: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  });

  const mainContent = styled('div', {
    flex: '1',
    overflow: 'auto',
  });

  main.append(mainHeader, mainContent);
  body.appendChild(main);

  // ================================================================
  // Shared state
  // ================================================================
  let currentMode: 'identity' | 'user' = 'identity';
  let statusData: StatusResponse | null = null;
  let filesData: FilesResponse | null = null;
  let selectedFile: string | null = null;
  let selectedRow: HTMLElement | null = null;
  let selectedUserGroupId: string | null = null;

  const showMessage = (msg: string): void => {
    mainContent.replaceChildren();
    mainHeader.replaceChildren();
    if (!msg) return;
    const p = styled('div', { padding: '16px', color: C.textDim, fontSize: '12px' });
    p.textContent = msg;
    mainContent.appendChild(p);
  };

  const selectRow = (row: HTMLElement): void => {
    if (selectedRow) { selectedRow.style.background = ''; delete selectedRow.dataset.selected; }
    selectedRow = row;
    row.dataset.selected = '1';
    row.style.background = C.selectedBg;
  };

  // ================================================================
  // Status helpers
  // ================================================================
  const getCurrentStatus = (): DbApplyStatus | null => {
    if (!statusData) return null;
    if (currentMode === 'identity') return statusData.identity;
    if (selectedUserGroupId) return statusData.userDbs.find((d) => d.label === selectedUserGroupId) ?? null;
    return statusData.userDbs[0] ?? null;
  };

  // ================================================================
  // File content loading
  // ================================================================
  const loadFileContent = async (name: string): Promise<void> => {
    mainContent.replaceChildren();
    mainHeader.replaceChildren();

    const nameEl = styled('span', { color: C.textBright, fontWeight: '600' });
    nameEl.textContent = name;
    mainHeader.appendChild(nameEl);

    const status = getCurrentStatus();
    if (status) {
      const isApplied = status.applied.includes(name);
      const isPendingExpand = status.pendingExpand.includes(name);
      const isPendingContract = status.pendingContract.includes(name);

      const badge = styled('span', {
        fontSize: '10px',
        padding: '1px 6px',
        borderRadius: '3px',
        fontWeight: '600',
      });
      if (isApplied) {
        badge.textContent = '✓ applied';
        badge.style.background = '#14532d';
        badge.style.color = C.expandColor;
      } else if (isPendingExpand) {
        badge.textContent = '▶ pending expand';
        badge.style.background = '#1c3326';
        badge.style.color = C.expandColor;
      } else if (isPendingContract) {
        badge.textContent = '▶ pending contract';
        badge.style.background = C.warningBg;
        badge.style.color = C.contractColor;
      }
      mainHeader.appendChild(badge);

      if (isPendingExpand) {
        const applyBtn = styled('button', {
          marginLeft: 'auto',
          padding: '2px 10px',
          fontSize: '11px',
          fontFamily: 'monospace',
          cursor: 'pointer',
          border: `1px solid ${C.expandColor}`,
          borderRadius: '3px',
          background: 'transparent',
          color: C.expandColor,
        });
        applyBtn.textContent = 'Apply Expand';
        applyBtn.addEventListener('click', () => {
          void applyAll(currentMode === 'identity' ? 'identity/expand' : 'user-dbs/expand', 'Expand');
        });
        mainHeader.appendChild(applyBtn);
      }

      if (isPendingContract) {
        const note = styled('span', {
          marginLeft: 'auto',
          fontSize: '10px',
          color: C.contractColor,
          opacity: '0.7',
        });
        note.textContent = 'CI deploy required before applying';
        mainHeader.appendChild(note);
      }
    }

    const loading = styled('div', { padding: '16px', color: C.textDim });
    loading.textContent = 'Loading...';
    mainContent.appendChild(loading);

    try {
      const type = currentMode === 'identity' ? 'identity' : 'user';
      const res = await fetch(`/api/v1/admin/db-apply/migration-file?type=${type}&name=${encodeURIComponent(name)}`);
      if (!res.ok) { showMessage(`Error: ${res.status}`); return; }
      const data = (await res.json()) as FileResponse;
      mainContent.replaceChildren();

      const pre = styled('pre', {
        margin: '0',
        padding: '12px',
        fontSize: '12px',
        color: C.text,
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        lineHeight: '1.5',
      });
      pre.textContent = data.sql;
      mainContent.appendChild(pre);
    } catch {
      showMessage('Failed to load file');
    }
  };

  // ================================================================
  // Sidebar file list
  // ================================================================
  const makeSectionHeader = (text: string, color: string): HTMLElement => {
    const el = styled('div', {
      padding: '4px 12px 2px',
      fontSize: '10px',
      fontWeight: '700',
      color,
      letterSpacing: '0.08em',
      userSelect: 'none',
    });
    el.textContent = text;
    return el;
  };

  const makeFileRow = (
    name: string,
    status: 'applied' | 'pending' | 'pending-contract',
  ): HTMLElement => {
    const row = styled('div', {
      padding: '3px 12px',
      cursor: 'pointer',
      fontSize: '12px',
      color: status === 'applied' ? C.appliedDim : status === 'pending-contract' ? C.contractColor : C.text,
      opacity: status === 'pending-contract' ? '0.55' : '1',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      userSelect: 'none',
      overflow: 'hidden',
    });

    const icon = styled('span', { fontSize: '10px', flexShrink: '0', color: status === 'applied' ? C.expandColor : 'inherit' });
    icon.textContent = status === 'applied' ? '✓' : '▶';

    const label = styled('span', {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      flex: '1',
    });
    label.textContent = name;
    label.title = name;

    row.append(icon, label);

    row.addEventListener('mouseenter', () => { if (!row.dataset.selected) row.style.background = C.hoverBg; });
    row.addEventListener('mouseleave', () => { if (!row.dataset.selected) row.style.background = ''; });
    row.addEventListener('click', () => {
      selectRow(row);
      selectedFile = name;
      void loadFileContent(name);
    });

    return row;
  };

  const buildSidebar = (): void => {
    sidebarList.replaceChildren();
    selectedRow = null;

    if (!filesData) {
      const msg = styled('div', { padding: '12px', color: C.textDim, fontSize: '12px' });
      msg.textContent = 'Loading files...';
      sidebarList.appendChild(msg);
      return;
    }

    const status = getCurrentStatus();
    const applied = new Set(status?.applied ?? []);
    const pendingExpand = new Set(status?.pendingExpand ?? []);
    const pendingContract = new Set(status?.pendingContract ?? []);

    const allExpand = [...filesData.expand];
    const allContract = [...filesData.contract];

    if (allExpand.length > 0) {
      sidebarList.appendChild(makeSectionHeader('EXPAND', C.expandColor));
      for (const name of allExpand) {
        const s = applied.has(name) ? 'applied' : 'pending';
        sidebarList.appendChild(makeFileRow(name, s));
      }
    }

    if (allContract.length > 0) {
      sidebarList.appendChild(makeSectionHeader('CONTRACT (needs CI deploy)', C.contractColor));
      for (const name of allContract) {
        const s = applied.has(name) ? 'applied' : 'pending-contract';
        sidebarList.appendChild(makeFileRow(name, s));
      }
    }

    if (allExpand.length === 0 && allContract.length === 0) {
      const msg = styled('div', { padding: '12px', color: C.textDim, fontSize: '12px' });
      msg.textContent = 'No migration files found';
      sidebarList.appendChild(msg);
    }
  };

  // ================================================================
  // Apply all
  // ================================================================
  const applyAll = async (endpoint: string, label: string): Promise<void> => {
    ciLog.style.display = '';
    ciLog.replaceChildren();
    logLine(`=== ${label} Apply start ===`);
    try {
      const res = await fetch(`/api/v1/admin/db-apply/${endpoint}`, { method: 'POST' });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        logLine(`Failed (HTTP ${res.status}): ${String(body.message ?? body.error ?? '')}`, true);
        return;
      }
      if ('results' in body && Array.isArray(body.results)) {
        for (const r of body.results as Array<{ label: string; applied: string[]; skipped: string[]; error?: string }>) {
          if (r.error) logLine(`  [${r.label}] Error: ${r.error}`, true);
          else logLine(`  [${r.label}] applied: ${r.applied.length} / skipped: ${r.skipped.length}`);
        }
        logLine(`=== Done (${(body.total as number | undefined) ?? (body.results as unknown[]).length} DBs) ===`);
      } else {
        const r = body as { applied: string[]; skipped: string[]; error?: string };
        if (r.error) logLine(`Error: ${r.error}`, true);
        else logLine(`applied: ${r.applied.length} / skipped: ${r.skipped.length}`);
        logLine('=== Done ===');
      }
      await loadData();
    } catch (e) {
      logLine(`Unexpected error: ${String(e)}`, true);
    }
  };

  // ================================================================
  // Data loading
  // ================================================================
  const loadData = async (): Promise<void> => {
    showMessage('Loading...');
    const type = currentMode === 'identity' ? 'identity' : 'user';
    try {
      const [statusRes, filesRes] = await Promise.all([
        fetch('/api/v1/admin/db-apply/status'),
        fetch(`/api/v1/admin/db-apply/migration-files?type=${type}`),
      ]);

      if (!statusRes.ok) {
        if (statusRes.status === 401) {
          showMessage('GitHub Connect login required. Click "GitHub Connect" above.');
        } else {
          showMessage(`Status fetch failed: HTTP ${statusRes.status}`);
        }
        return;
      }

      statusData = (await statusRes.json()) as StatusResponse;
      filesData = filesRes.ok ? (await filesRes.json()) as FilesResponse : { expand: [], contract: [] };

      if (currentMode === 'user') {
        userSelect.style.display = '';
        const groups = statusData.userDbs.map((d) => d.label);
        userSelect.replaceChildren();
        if (groups.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = '(no user DBs)';
          userSelect.appendChild(opt);
        } else {
          for (const g of groups) {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            userSelect.appendChild(opt);
          }
          if (!selectedUserGroupId || !groups.includes(selectedUserGroupId)) {
            selectedUserGroupId = groups[0];
          }
          userSelect.value = selectedUserGroupId ?? groups[0];
        }
      } else {
        userSelect.style.display = 'none';
        selectedUserGroupId = null;
      }

      buildSidebar();
      mainContent.replaceChildren();
      mainHeader.replaceChildren();
      renderStatusSummary();
    } catch (e) {
      showMessage(`Error: ${String(e)}`);
    }
  };

  const renderStatusSummary = (): void => {
    const status = getCurrentStatus();
    if (!status) { showMessage('Select a user DB'); return; }

    mainContent.replaceChildren();
    mainHeader.replaceChildren();

    const title = styled('span', { color: C.textBright, fontWeight: '600' });
    title.textContent = status.label;
    mainHeader.appendChild(title);

    if (!status.tableExists) {
      const warn = styled('span', { color: C.contractColor, fontSize: '11px' });
      warn.textContent = '⚠ _migrations table not initialized';
      mainHeader.appendChild(warn);
    }

    const makeStat = (label: string, count: number, color: string): HTMLElement => {
      const el = styled('div', {
        padding: '12px 16px',
        borderLeft: `3px solid ${color}`,
        marginBottom: '8px',
        background: C.surface,
        borderRadius: '0 4px 4px 0',
      });
      const h = styled('div', { fontWeight: '600', fontSize: '13px', color: C.textBright, marginBottom: '4px' });
      h.textContent = `${label} (${count})`;
      el.appendChild(h);
      return el;
    };

    const container = styled('div', { padding: '12px' });
    container.appendChild(makeStat('Applied', status.applied.length, C.appliedDim));
    container.appendChild(makeStat('Pending Expand', status.pendingExpand.length, C.expandColor));
    const contractStat = makeStat('Pending Contract', status.pendingContract.length, C.contractColor);
    const contractNote = styled('div', { fontSize: '11px', color: C.textDim, marginTop: '4px' });
    contractNote.textContent = 'Contract migrations require CI deploy (stage→main) before applying.';
    contractStat.appendChild(contractNote);
    container.appendChild(contractStat);

    const ts = styled('div', { fontSize: '10px', color: C.textDim, marginTop: '8px' });
    ts.textContent = `Last refreshed: ${new Date().toLocaleString('ja-JP')}`;
    container.appendChild(ts);

    mainContent.appendChild(container);
  };

  // ================================================================
  // CI Deploy
  // ================================================================
  const pollCiStatus = async (): Promise<void> => {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 10000));
      try {
        const res = await fetch('/api/v1/admin/db-apply/ci-status');
        if (!res.ok) continue;
        const body = (await res.json()) as { run: { status: string; conclusion: string | null; html_url: string; name: string } | null };
        const run = body.run;
        if (!run) { logLine(`CI waiting... (${i + 1}/60)`); continue; }
        logLine(`CI [${run.name}] status: ${run.status} / conclusion: ${run.conclusion ?? '—'}`);
        if (run.status === 'completed') {
          logLine(`=== CI ${run.conclusion === 'success' ? 'succeeded' : 'failed'}: ${run.html_url} ===`, run.conclusion !== 'success');
          return;
        }
      } catch { /* retry */ }
    }
    logLine('CI status check timed out', true);
  };

  ciDeployBtn.addEventListener('click', () => {
    void (async () => {
      ciLog.style.display = '';
      ciLog.replaceChildren();
      ciDeployBtn.disabled = true;
      logLine('=== CI Deploy start (stage → main) ===');
      try {
        const res = await fetch('/api/v1/admin/db-apply/ci-deploy', { method: 'POST' });
        const body = (await res.json()) as { merged?: boolean; alreadyUpToDate?: boolean; conflict?: boolean };
        if (res.status === 409) { logLine('Conflict. Resolve manually.', true); return; }
        if (!res.ok) { logLine(`Failed: HTTP ${res.status}`, true); return; }
        if (body.alreadyUpToDate) logLine('Already up to date');
        else logLine('Merged. Waiting for CI workflow...');
        await pollCiStatus();
      } catch (e) {
        logLine(`Unexpected error: ${String(e)}`, true);
      } finally {
        ciDeployBtn.disabled = false;
      }
    })();
  });

  runMigrateBtn.addEventListener('click', () => {
    void (async () => {
      ciLog.style.display = '';
      ciLog.replaceChildren();
      runMigrateBtn.disabled = true;
      logLine('=== Migration Runner start ===');
      try {
        const res = await fetch('/api/v1/admin/db-apply/migrate-auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const body = await res.json() as Record<string, unknown>;
        if (!res.ok) { logLine(`Failed: ${String(body.message ?? body.error ?? res.status)}`, true); return; }
        const runId = body.runId as string;
        logLine(`Workflow started: ${runId}`);
        for (let i = 0; i < 120; i++) {
          await new Promise(r => setTimeout(r, 5000));
          try {
            const statusRes = await fetch(`/api/v1/admin/db-apply/migrate/${runId}`);
            if (!statusRes.ok) { logLine(`Status check failed: ${statusRes.status}`, true); continue; }
            const s = await statusRes.json() as { status: string; output?: { identity?: { applied: string[]; skipped: string[]; error?: string }; secrets?: { applied: string[]; skipped: string[]; error?: string } | null; groups?: Array<{ label: string; applied: string[]; skipped: string[]; error?: string }>; identityFailed?: boolean } };
            logLine(`[${i + 1}] status: ${s.status}`);
            if (s.status === 'complete' || s.status === 'errored') {
              if (s.output) {
                const out = s.output;
                if (out.identityFailed) logLine('Identity DB migration FAILED', true);
                else {
                  if (out.identity) logLine(`identity: applied=${out.identity.applied.length} skipped=${out.identity.skipped.length}${out.identity.error ? ' ERROR: ' + out.identity.error : ''}`);
                  if (out.secrets) logLine(`secrets: applied=${out.secrets.applied.length} skipped=${out.secrets.skipped.length}${out.secrets.error ? ' ERROR: ' + out.secrets.error : ''}`);
                  if (out.groups) {
                    const failed = out.groups.filter(g => g.error);
                    logLine(`groups: total=${out.groups.length} failed=${failed.length}`);
                    for (const f of failed) logLine(`  [${f.label}] Error: ${f.error}`, true);
                  }
                }
              }
              logLine(`=== Migration Runner ${s.status} ===`, s.status !== 'complete');
              break;
            }
          } catch { /* retry */ }
        }
      } catch (e) {
        logLine(`Unexpected error: ${String(e)}`, true);
      } finally {
        runMigrateBtn.disabled = false;
      }
    })();
  });

  // ================================================================
  // Wiring
  // ================================================================
  applyExpandBtn.addEventListener('click', () => {
    const ep = currentMode === 'identity' ? 'identity/expand' : 'user-dbs/expand';
    void applyAll(ep, 'Expand');
  });

  applyContractBtn.addEventListener('click', () => {
    const ep = currentMode === 'identity' ? 'identity/contract' : 'user-dbs/contract';
    void applyAll(ep, 'Contract');
  });

  reloadBtn.addEventListener('click', () => { void loadData(); });

  userSelect.addEventListener('change', () => {
    selectedUserGroupId = userSelect.value || null;
    buildSidebar();
    renderStatusSummary();
  });

  const activateTab = (mode: 'identity' | 'user'): void => {
    currentMode = mode;
    identityTab.style.background = mode === 'identity' ? C.bg : 'transparent';
    identityTab.style.color = mode === 'identity' ? C.textBright : C.textDim;
    userDbTab.style.background = mode === 'user' ? C.bg : 'transparent';
    userDbTab.style.color = mode === 'user' ? C.textBright : C.textDim;
    selectedFile = null;
    filesData = null;
    void loadData();
  };

  identityTab.addEventListener('click', () => activateTab('identity'));
  userDbTab.addEventListener('click', () => activateTab('user'));

  activateTab('identity');

  return root;
};
