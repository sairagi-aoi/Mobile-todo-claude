(function () {
  'use strict';

  var STORAGE_KEY = 'mobile-todo.tasks.v1';
  var MAX_LENGTH = 200;

  var EMPTY_MESSAGES = {
    all: 'タスクはまだありません。\n下の入力欄から追加しましょう。',
    active: '未完了のタスクはありません 🎉',
    done: '完了したタスクはありません'
  };

  var state = {
    tasks: loadTasks(),
    filter: 'all',
    editingId: null
  };

  var els = {
    list: document.getElementById('task-list'),
    empty: document.getElementById('empty'),
    summary: document.getElementById('summary'),
    filters: document.querySelectorAll('.filter'),
    clearDone: document.getElementById('clear-done'),
    addForm: document.getElementById('add-form'),
    addInput: document.getElementById('add-input'),
    addButton: document.getElementById('add-button'),
    dialog: document.getElementById('edit-dialog'),
    editForm: document.getElementById('edit-form'),
    editInput: document.getElementById('edit-input'),
    editCancel: document.getElementById('edit-cancel'),
    editDelete: document.getElementById('edit-delete')
  };

  // ---- ストレージ ----

  function loadTasks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (t) {
        return t && typeof t.id === 'string' && typeof t.title === 'string';
      }).map(function (t) {
        return {
          id: t.id,
          title: t.title,
          done: Boolean(t.done),
          createdAt: Number(t.createdAt) || Date.now(),
          updatedAt: Number(t.updatedAt) || Date.now()
        };
      });
    } catch (e) {
      return [];
    }
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (e) {
      // プライベートブラウズや容量超過で保存できない場合でも操作は継続する
      console.warn('タスクを保存できませんでした', e);
    }
  }

  // ---- タスク操作 ----

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeTitle(value) {
    return String(value || '').trim().slice(0, MAX_LENGTH);
  }

  function findTask(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  function addTask(title) {
    var now = Date.now();
    var task = { id: createId(), title: title, done: false, createdAt: now, updatedAt: now };
    state.tasks.push(task);
    commit();
    return task;
  }

  function updateTask(id, changes) {
    var task = findTask(id);
    if (!task) return;
    Object.keys(changes).forEach(function (key) {
      task[key] = changes[key];
    });
    task.updatedAt = Date.now();
    commit();
  }

  function deleteTask(id) {
    state.tasks = state.tasks.filter(function (t) { return t.id !== id; });
    commit();
  }

  function clearDone() {
    state.tasks = state.tasks.filter(function (t) { return !t.done; });
    commit();
  }

  function commit() {
    saveTasks();
    render();
  }

  // ---- 描画 ----

  function visibleTasks() {
    return state.tasks.filter(function (t) {
      if (state.filter === 'active') return !t.done;
      if (state.filter === 'done') return t.done;
      return true;
    });
  }

  function renderTask(task) {
    var li = document.createElement('li');
    li.className = 'task' + (task.done ? ' is-done' : '');
    li.dataset.id = task.id;

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'task-check';
    check.dataset.action = 'toggle';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(task.done));
    check.setAttribute('aria-label', (task.done ? '未完了に戻す: ' : '完了にする: ') + task.title);
    check.innerHTML =
      '<span class="circle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>';

    var title = document.createElement('button');
    title.type = 'button';
    title.className = 'task-title';
    title.dataset.action = 'edit';
    title.textContent = task.title;
    title.setAttribute('aria-label', '編集: ' + task.title);

    li.appendChild(check);
    li.appendChild(title);
    return li;
  }

  function render() {
    var tasks = visibleTasks();
    var fragment = document.createDocumentFragment();
    tasks.forEach(function (t) { fragment.appendChild(renderTask(t)); });
    els.list.replaceChildren(fragment);

    els.empty.hidden = tasks.length > 0;
    els.empty.textContent = EMPTY_MESSAGES[state.filter];

    var total = state.tasks.length;
    var doneCount = state.tasks.filter(function (t) { return t.done; }).length;
    els.summary.textContent = total === 0
      ? 'タスクなし'
      : '残り ' + (total - doneCount) + ' 件 / 全 ' + total + ' 件';

    els.clearDone.hidden = doneCount === 0 || state.filter === 'active';

    els.filters.forEach(function (btn) {
      var active = btn.dataset.filter === state.filter;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
  }

  // ---- 編集シート ----

  function openEditor(id) {
    var task = findTask(id);
    if (!task) return;
    state.editingId = id;
    els.editInput.value = task.title;
    if (typeof els.dialog.showModal === 'function') {
      els.dialog.showModal();
    } else {
      els.dialog.setAttribute('open', '');
    }
    els.editInput.focus();
  }

  function closeEditor() {
    state.editingId = null;
    if (els.dialog.open) {
      if (typeof els.dialog.close === 'function') {
        els.dialog.close();
      } else {
        els.dialog.removeAttribute('open');
      }
    }
  }

  // ---- イベント ----

  els.addInput.addEventListener('input', function () {
    els.addButton.disabled = normalizeTitle(els.addInput.value) === '';
  });

  els.addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = normalizeTitle(els.addInput.value);
    if (!title) return;
    if (state.filter === 'done') state.filter = 'all';
    var task = addTask(title);
    els.addInput.value = '';
    els.addButton.disabled = true;
    // 連続入力しやすいようにフォーカスは入力欄に残す
    els.addInput.focus();
    var added = els.list.querySelector('[data-id="' + task.id + '"]');
    if (added && added.scrollIntoView) added.scrollIntoView({ block: 'nearest' });
  });

  els.list.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var li = target.closest('.task');
    if (!li) return;
    var id = li.dataset.id;
    if (target.dataset.action === 'toggle') {
      var task = findTask(id);
      if (task) updateTask(id, { done: !task.done });
    } else if (target.dataset.action === 'edit') {
      openEditor(id);
    }
  });

  els.filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.filter = btn.dataset.filter;
      render();
    });
  });

  els.clearDone.addEventListener('click', function () {
    var count = state.tasks.filter(function (t) { return t.done; }).length;
    if (count === 0) return;
    if (window.confirm('完了したタスク ' + count + ' 件を削除しますか？')) clearDone();
  });

  els.editForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = normalizeTitle(els.editInput.value);
    if (!title) {
      els.editInput.focus();
      return;
    }
    if (state.editingId) updateTask(state.editingId, { title: title });
    closeEditor();
  });

  // 改行ではなく Enter で保存（Shift+Enter は改行）
  els.editInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.editForm.requestSubmit ? els.editForm.requestSubmit() : els.editForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  els.editCancel.addEventListener('click', closeEditor);

  els.editDelete.addEventListener('click', function () {
    var id = state.editingId;
    if (!id) return;
    if (window.confirm('このタスクを削除しますか？')) {
      closeEditor();
      deleteTask(id);
    }
  });

  // 背景タップで閉じる
  els.dialog.addEventListener('click', function (e) {
    if (e.target === els.dialog) closeEditor();
  });

  els.dialog.addEventListener('close', function () {
    state.editingId = null;
  });

  // 別タブでの変更を反映
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      state.tasks = loadTasks();
      render();
    }
  });

  render();
})();
