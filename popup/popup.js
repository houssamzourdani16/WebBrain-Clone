'use strict';

/**
 * Clone WebBrain — popup controller.
 *
 * Storage contract (chrome.storage.local only):
 *   cloneWebBrain.apiBaseUrl      → Vercel deployment URL
 *   cloneWebBrain.extensionApiKey → EXTENSION_API_KEY value
 *
 * The popup never sees MongoDB. It only performs GET /api/tasks and renders the
 * 30-day checklist read-only; task completion is owned by the AI agent.
 */

const STORAGE_KEYS = {
  apiBaseUrl: 'cloneWebBrain.apiBaseUrl',
  extensionApiKey: 'cloneWebBrain.extensionApiKey'
};

const FETCH_TIMEOUT_MS = 15000;
const taskState = { tasks: [], loading: false, apiBaseUrl: '', apiKey: '' };

const el = {
  refreshBtn: document.getElementById('refreshBtn'),
  tabBtnTasks: document.getElementById('tabBtnTasks'),
  tabBtnSettings: document.getElementById('tabBtnSettings'),
  tabTasks: document.getElementById('tab-tasks'),
  tabSettings: document.getElementById('tab-settings'),
  summary: document.getElementById('summary'),
  doneCount: document.getElementById('doneCount'),
  pendingCount: document.getElementById('pendingCount'),
  progressLabel: document.getElementById('progressLabel'),
  progressBar: document.getElementById('progressBar'),
  listState: document.getElementById('listState'),
  taskList: document.getElementById('taskList'),
  apiBaseUrl: document.getElementById('apiBaseUrl'),
  extensionApiKey: document.getElementById('extensionApiKey'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  testBtn: document.getElementById('testBtn'),
  openManageBtn: document.getElementById('openManageBtn'),
  toast: document.getElementById('toast')
};

let toastTimer = null;

function showToast(message, isError) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', Boolean(isError));
  el.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 4000);
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result || {});
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });
}

function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isHttpUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(normalizeBase(value));
}

async function getSettings() {
  const stored = await storageGet([STORAGE_KEYS.apiBaseUrl, STORAGE_KEYS.extensionApiKey]);
  return {
    apiBaseUrl: normalizeBase(stored[STORAGE_KEYS.apiBaseUrl]),
    apiKey: String(stored[STORAGE_KEYS.extensionApiKey] || '').trim()
  };
}

async function fetchTasks(settings) {
  const base = normalizeBase(settings.apiBaseUrl);
  if (!base) throw new Error('No API base URL configured.');
  if (!settings.apiKey) throw new Error('No extension API key configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${base}/api/tasks`, {
      method: 'GET',
      headers: {
        'X-API-Key': settings.apiKey,
        Accept: 'application/json'
      },
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Request timed out after 15s. Check the deployment and your connection.');
    }
    throw new Error(
      'Could not reach the API. Verify the base URL and that the Vercel deployment is live.'
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_err) {
      data = null;
    }
  }

  if (!response.ok) {
    const detail = data && data.error ? data.error : `HTTP ${response.status}`;
    throw new Error(`API error: ${detail}`);
  }
  if (!data || !Array.isArray(data.tasks)) {
    throw new Error('Unexpected API response. Expected { tasks: [...] }.');
  }
  return data.tasks;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showState(title, message, options) {
  const opts = options || {};
  el.listState.innerHTML = '';

  const strong = document.createElement('strong');
  strong.textContent = title;
  el.listState.appendChild(strong);

  const p = document.createElement('div');
  p.textContent = message;
  el.listState.appendChild(p);

  if (Array.isArray(opts.bullets) && opts.bullets.length) {
    const ul = document.createElement('ul');
    for (const bullet of opts.bullets) {
      const li = document.createElement('li');
      li.textContent = bullet;
      ul.appendChild(li);
    }
    el.listState.appendChild(ul);
  }

  if (opts.actionLabel && typeof opts.onAction === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = opts.actionLabel;
    button.addEventListener('click', opts.onAction);
    el.listState.appendChild(button);
  }

  el.listState.classList.remove('hidden');
  el.listState.classList.toggle('error', Boolean(opts.isError));
}

function hideState() {
  el.listState.classList.add('hidden');
  el.listState.innerHTML = '';
}

function updateSummary(tasks) {
  const total = tasks.length;
  const done = tasks.filter((task) => task.status === 'done').length;
  const pending = total - done;
  const percent = total ? Math.round((done / total) * 100) : 0;

  el.doneCount.textContent = String(done);
  el.pendingCount.textContent = String(pending);
  el.progressLabel.textContent = `${percent}%`;
  el.progressBar.style.width = `${percent}%`;
  el.summary.classList.toggle('hidden', total === 0);
}

function renderTasks(tasks) {
  el.taskList.innerHTML = '';
  updateSummary(tasks);

  for (const task of tasks) {
    const isDone = task.status === 'done';
    const li = document.createElement('li');
    li.className = 'task' + (isDone ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = isDone;
    checkbox.disabled = true;
    checkbox.title = 'Only the AI agent can change task status';
    checkbox.setAttribute('aria-label', `Day ${task.day} ${isDone ? 'done' : 'pending'}`);

    const dayBadge = document.createElement('span');
    dayBadge.className = 'day';
    dayBadge.textContent = `D${task.day}`;

    const body = document.createElement('div');
    body.className = 'task-body';

    const head = document.createElement('div');
    head.className = 'task-head';

    const title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title || `Day ${task.day}`;
    title.title = task.title || '';

    const status = document.createElement('span');
    status.className = 'status ' + (isDone ? 'done' : 'pending');
    status.textContent = isDone ? '✅ Done' : '⏳ Pending';

    head.appendChild(title);
    head.appendChild(status);
    body.appendChild(head);

    const prompt = document.createElement('p');
    prompt.className = 'task-prompt';
    prompt.textContent = task.prompt || 'No prompt set for this task.';
    prompt.title = task.details ? `${task.prompt || ''}\n\n${task.details}` : task.prompt || '';
    body.appendChild(prompt);

    if (isDone && task.completedAt) {
      const meta = document.createElement('p');
      meta.className = 'task-meta';
      meta.textContent = `${task.completedBy || 'ai_agent'} · ${formatDateTime(task.completedAt)}`;
      body.appendChild(meta);
    }

    li.appendChild(checkbox);
    li.appendChild(dayBadge);
    li.appendChild(body);
    el.taskList.appendChild(li);
  }
}

function setLoading(isLoading) {
  taskState.loading = isLoading;
  el.refreshBtn.disabled = isLoading;
  el.refreshBtn.textContent = isLoading ? 'Loading…' : 'Refresh';
}

async function loadTasks(options) {
  const opts = options || {};
  if (taskState.loading) return;

  el.taskList.innerHTML = '';
  el.summary.classList.add('hidden');
  setLoading(true);

  try {
    const settings = opts.settings || (await getSettings());
    taskState.apiBaseUrl = settings.apiBaseUrl;
    taskState.apiKey = settings.apiKey;

    if (!settings.apiBaseUrl || !settings.apiKey) {
      showState(
        'Finish setup',
        'Add your Vercel API base URL and extension API key to load the 30-day task list.',
        {
          actionLabel: 'Open settings',
          onAction: () => switchTab('settings')
        }
      );
      return;
    }

    showState('Loading tasks…', 'Fetching your 30-day plan from the API.');
    const tasks = await fetchTasks(settings);
    tasks.sort((a, b) => Number(a.day) - Number(b.day));

    taskState.tasks = tasks;
    hideState();
    renderTasks(tasks);

    if (!tasks.length) {
      showState(
        'No tasks yet',
        'The API returned zero tasks. Seed the database or add tasks from the CRUD page.',
        {
          actionLabel: 'Open CRUD page',
          onAction: openManagePage
        }
      );
    }
  } catch (err) {
    const message = err && err.message ? err.message : 'Unknown error';
    const isAuth = /unauthorized|api key|401/i.test(message);
    showState(isAuth ? 'API key rejected' : 'Could not load tasks', message, {
      bullets: isAuth
        ? ['Check that EXTENSION_API_KEY in Vercel matches the key saved here.']
        : ['Verify the API base URL.', 'Check that the deployment is live and MongoDB is reachable.'],
      actionLabel: 'Retry',
      onAction: () => loadTasks(),
      isError: true
    });
    console.error('[Clone WebBrain] Failed to load tasks:', message);
  } finally {
    setLoading(false);
  }
}

function switchTab(name) {
  const isTasks = name === 'tasks';
  el.tabTasks.classList.toggle('hidden', !isTasks);
  el.tabSettings.classList.toggle('hidden', isTasks);
  el.tabBtnTasks.classList.toggle('active', isTasks);
  el.tabBtnSettings.classList.toggle('active', !isTasks);

  if (!isTasks) {
    el.apiBaseUrl.value = taskState.apiBaseUrl;
    el.extensionApiKey.value = taskState.apiKey;
  }
}

function openManagePage() {
  const base = normalizeBase(taskState.apiBaseUrl || el.apiBaseUrl.value);
  if (!isHttpUrl(base)) {
    showToast('Set a valid API base URL first.', true);
    switchTab('settings');
    return;
  }
  chrome.tabs.create({ url: `${base}/manage.html` });
}

async function saveSettings() {
  const base = normalizeBase(el.apiBaseUrl.value);
  const key = el.extensionApiKey.value.trim();

  if (!isHttpUrl(base)) {
    showToast('Enter a full URL including https://', true);
    el.apiBaseUrl.focus();
    return;
  }
  if (!key) {
    showToast('Enter the extension API key.', true);
    el.extensionApiKey.focus();
    return;
  }

  try {
    await storageSet({
      [STORAGE_KEYS.apiBaseUrl]: base,
      [STORAGE_KEYS.extensionApiKey]: key
    });
    taskState.apiBaseUrl = base;
    taskState.apiKey = key;
    showToast('Settings saved.');
    switchTab('tasks');
    await loadTasks({ settings: { apiBaseUrl: base, apiKey: key } });
  } catch (err) {
    showToast(`Could not save settings: ${err.message}`, true);
  }
}

async function testConnection() {
  const base = normalizeBase(el.apiBaseUrl.value);
  const key = el.extensionApiKey.value.trim();

  if (!isHttpUrl(base)) {
    showToast('Enter a full URL including https://', true);
    return;
  }
  if (!key) {
    showToast('Enter the extension API key.', true);
    return;
  }

  el.testBtn.disabled = true;
  el.testBtn.textContent = 'Testing…';
  try {
    const tasks = await fetchTasks({ apiBaseUrl: base, apiKey: key });
    showToast(`Connection OK — ${tasks.length} task${tasks.length === 1 ? '' : 's'} returned.`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    el.testBtn.disabled = false;
    el.testBtn.textContent = 'Test';
  }
}

function bindEvents() {
  el.tabBtnTasks.addEventListener('click', () => switchTab('tasks'));
  el.tabBtnSettings.addEventListener('click', () => switchTab('settings'));
  el.refreshBtn.addEventListener('click', () => loadTasks());
  el.saveSettingsBtn.addEventListener('click', saveSettings);
  el.testBtn.addEventListener('click', testConnection);
  el.openManageBtn.addEventListener('click', openManagePage);

  for (const input of [el.apiBaseUrl, el.extensionApiKey]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveSettings();
      }
    });
  }
}

async function init() {
  bindEvents();
  try {
    const settings = await getSettings();
    taskState.apiBaseUrl = settings.apiBaseUrl;
    taskState.apiKey = settings.apiKey;
    el.apiBaseUrl.value = settings.apiBaseUrl;
    el.extensionApiKey.value = settings.apiKey;

    if (!settings.apiBaseUrl || !settings.apiKey) {
      switchTab('settings');
      showToast('Add your API base URL and extension API key to begin.');
      return;
    }
    await loadTasks({ settings });
  } catch (err) {
    showState('Storage error', err.message || 'Could not read extension settings.', {
      isError: true
    });
  }
  console.log('[Clone WebBrain] Popup ready.');
}

document.addEventListener('DOMContentLoaded', init);



