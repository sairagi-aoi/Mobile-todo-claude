(function () {
  'use strict';

  var STORAGE_KEY = 'mobile-todo.tasks.v1';
  var MAX_TITLE = 200;
  var MAX_NOTE = 2000;
  // 親・子・孫・ひ孫の 4 階層まで（スマホの横幅で読める深さに制限）
  var MAX_DEPTH = 4;
  // 1 階層あたりのインデント幅(px)。style.css の --indent と合わせる
  var INDENT = 24;

  var EMPTY_MESSAGES = {
    all: 'タスクはまだありません。\n下の入力欄から追加しましょう。',
    active: '未完了のタスクはありません 🎉',
    done: '完了したタスクはありません'
  };

  var state = {
    tasks: loadTasks(),
    filter: 'all',
    editingId: null,
    addParentId: null
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
    addContext: document.getElementById('add-context'),
    addContextTitle: document.getElementById('add-context-title'),
    addContextClear: document.getElementById('add-context-clear'),
    dialog: document.getElementById('edit-dialog'),
    editForm: document.getElementById('edit-form'),
    editTitle: document.getElementById('edit-title-input'),
    editNote: document.getElementById('edit-note'),
    editParent: document.getElementById('edit-parent'),
    editCancel: document.getElementById('edit-cancel'),
    editAddSub: document.getElementById('edit-add-sub'),
    editDelete: document.getElementById('edit-delete'),
    dropIndicator: document.getElementById('drop-indicator')
  };

  // ---- ストレージ ----

  function loadTasks() {
    var parsed;
    try {
      parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    var byId = {};
    var tasks = [];
    parsed.forEach(function (t) {
      if (!t || typeof t.id !== 'string' || typeof t.title !== 'string' || byId[t.id]) return;
      var task = {
        id: t.id,
        title: t.title,
        note: typeof t.note === 'string' ? t.note : '',
        done: Boolean(t.done),
        parentId: typeof t.parentId === 'string' ? t.parentId : null,
        collapsed: Boolean(t.collapsed),
        createdAt: Number(t.createdAt) || Date.now(),
        updatedAt: Number(t.updatedAt) || Date.now()
      };
      byId[task.id] = task;
      tasks.push(task);
    });

    // 存在しない親・循環参照は最上位に戻す
    tasks.forEach(function (task) {
      if (task.parentId && !byId[task.parentId]) task.parentId = null;
      var seen = {};
      var cur = task;
      while (cur && cur.parentId) {
        if (seen[cur.id]) {
          task.parentId = null;
          break;
        }
        seen[cur.id] = true;
        cur = byId[cur.parentId];
      }
    });

    normalizeDone(tasks);
    return tasks;
  }

  function saveTasks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
    } catch (e) {
      // プライベートブラウズや容量超過で保存できない場合でも操作は継続する
      console.warn('タスクを保存できませんでした', e);
    }
  }

  // ---- ツリー操作のヘルパー ----

  function getTask(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return state.tasks[i];
    }
    return null;
  }

  // 親 ID ごとに子タスクを並び順どおりにまとめる（最上位のキーは ''）
  function groupChildren(tasks) {
    var map = {};
    tasks.forEach(function (t) {
      var key = t.parentId || '';
      (map[key] = map[key] || []).push(t);
    });
    return map;
  }

  function childrenOf(id) {
    return state.tasks.filter(function (t) { return t.parentId === id; });
  }

  function descendantsOf(id) {
    var result = [];
    childrenOf(id).forEach(function (child) {
      result.push(child);
      result.push.apply(result, descendantsOf(child.id));
    });
    return result;
  }

  function depthOf(task) {
    var depth = 0;
    var cur = task;
    while (cur && cur.parentId) {
      cur = getTask(cur.parentId);
      depth++;
    }
    return depth;
  }

  // 自分の下にある階層の深さ（子がなければ 0）
  function subtreeHeight(id) {
    var max = 0;
    childrenOf(id).forEach(function (child) {
      max = Math.max(max, 1 + subtreeHeight(child.id));
    });
    return max;
  }

  function isAncestor(ancestorId, task) {
    var cur = task;
    while (cur && cur.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = getTask(cur.parentId);
    }
    return false;
  }

  // 「完了済みの親の下には未完了の子がない」状態を保つ。
  // 未完了の子がある親は未完了に戻す。
  function normalizeDone(tasks) {
    var kids = groupChildren(tasks);
    function visit(key) {
      var allDone = true;
      (kids[key] || []).forEach(function (t) {
        var childrenDone = visit(t.id);
        if (t.done && !childrenDone) t.done = false;
        if (!t.done) allDone = false;
      });
      return allDone;
    }
    visit('');
  }

  // ---- タスク操作 ----

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalizeTitle(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  }

  function normalizeNote(value) {
    return String(value || '').replace(/\s+$/, '').slice(0, MAX_NOTE);
  }

  function addTask(title, parentId) {
    var now = Date.now();
    var task = {
      id: createId(),
      title: title,
      note: '',
      done: false,
      parentId: parentId || null,
      collapsed: false,
      createdAt: now,
      updatedAt: now
    };
    // 配列の末尾に置くと、同じ親の子の中で最後になる
    state.tasks.push(task);
    expand(parentId);
    commit();
    return task;
  }

  function updateTask(id, changes) {
    var task = getTask(id);
    if (!task) return;
    Object.keys(changes).forEach(function (key) {
      task[key] = changes[key];
    });
    task.updatedAt = Date.now();
    commit();
  }

  function toggleDone(id) {
    var task = getTask(id);
    if (!task) return;
    task.done = !task.done;
    task.updatedAt = Date.now();
    // 親を完了にしたらサブタスクもすべて完了にする（未完了に戻した場合は normalizeDone が親を戻す）
    if (task.done) {
      descendantsOf(id).forEach(function (t) { t.done = true; });
    }
    commit();
  }

  function toggleCollapsed(id) {
    var task = getTask(id);
    if (!task) return;
    task.collapsed = !task.collapsed;
    commit();
  }

  function expand(id) {
    var task = id && getTask(id);
    if (task) task.collapsed = false;
  }

  function removeTasks(ids) {
    var remove = {};
    ids.forEach(function (id) {
      remove[id] = true;
      descendantsOf(id).forEach(function (t) { remove[t.id] = true; });
    });
    state.tasks = state.tasks.filter(function (t) { return !remove[t.id]; });
    if (state.addParentId && remove[state.addParentId]) state.addParentId = null;
    commit();
  }

  // id のタスク（サブタスクごと）を parentId の子にし、afterId の直後に置く。
  // afterId が null なら先頭の子にする。
  function moveTask(id, parentId, afterId) {
    var task = getTask(id);
    if (!task) return false;
    parentId = parentId || null;
    if (parentId === id || (parentId && isAncestor(id, getTask(parentId)))) return false;

    state.tasks.splice(state.tasks.indexOf(task), 1);
    task.parentId = parentId;

    var index;
    var after = afterId && afterId !== id ? getTask(afterId) : null;
    if (after) {
      index = state.tasks.indexOf(after) + 1;
    } else {
      var first = null;
      for (var i = 0; i < state.tasks.length; i++) {
        if (state.tasks[i].parentId === parentId) { first = state.tasks[i]; break; }
      }
      index = first ? state.tasks.indexOf(first) : state.tasks.length;
    }
    state.tasks.splice(index, 0, task);
    task.updatedAt = Date.now();
    expand(parentId);
    commit();
    return true;
  }

  function commit() {
    normalizeDone(state.tasks);
    saveTasks();
    render();
  }

  // ---- 描画 ----

  function matchesFilter(task) {
    if (state.filter === 'active') return !task.done;
    if (state.filter === 'done') return task.done;
    return true;
  }

  // 画面に表示する行を、ツリーの順番で平らな配列にする。
  // 絞り込み中は、条件に合うサブタスクの親も「文脈」として表示する。
  function buildRows() {
    var kids = groupChildren(state.tasks);
    function collect(key, depth) {
      var rows = [];
      (kids[key] || []).forEach(function (task) {
        var childRows = collect(task.id, depth + 1);
        var match = matchesFilter(task);
        if (!match && childRows.length === 0) return;
        var children = kids[task.id] || [];
        rows.push({
          task: task,
          depth: depth,
          context: !match,
          childCount: children.length,
          doneCount: children.filter(function (c) { return c.done; }).length
        });
        if (!task.collapsed) rows.push.apply(rows, childRows);
      });
      return rows;
    }
    return collect('', 0);
  }

  var ICONS = {
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    check: '<span class="circle"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>'
  };

  function renderRow(row, draggable) {
    var task = row.task;
    var li = document.createElement('li');
    li.className = 'task' +
      (task.done ? ' is-done' : '') +
      (row.context ? ' is-context' : '');
    li.dataset.id = task.id;
    li.dataset.depth = String(row.depth);
    li.style.setProperty('--depth', row.depth);

    if (row.childCount > 0) {
      var toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'task-toggle';
      toggle.dataset.action = 'collapse';
      toggle.setAttribute('aria-expanded', String(!task.collapsed));
      toggle.setAttribute('aria-label', (task.collapsed ? 'サブタスクを表示: ' : 'サブタスクを隠す: ') + task.title);
      toggle.innerHTML = ICONS.chevron;
      li.appendChild(toggle);
    } else {
      var spacer = document.createElement('span');
      spacer.className = 'task-toggle';
      li.appendChild(spacer);
    }

    var check = document.createElement('button');
    check.type = 'button';
    check.className = 'task-check';
    check.dataset.action = 'toggle';
    check.setAttribute('role', 'checkbox');
    check.setAttribute('aria-checked', String(task.done));
    check.setAttribute('aria-label', (task.done ? '未完了に戻す: ' : '完了にする: ') + task.title);
    check.innerHTML = ICONS.check;
    li.appendChild(check);

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'task-body';
    body.dataset.action = 'edit';
    body.setAttribute('aria-label', '詳細を開く: ' + task.title);

    var title = document.createElement('span');
    title.className = 'task-title';
    title.textContent = task.title;
    body.appendChild(title);

    if (row.childCount > 0 || task.note) {
      var meta = document.createElement('span');
      meta.className = 'task-meta';
      if (row.childCount > 0) {
        var progress = document.createElement('span');
        progress.className = 'task-progress';
        progress.textContent = row.doneCount + '/' + row.childCount;
        meta.appendChild(progress);
      }
      if (task.note) {
        var note = document.createElement('span');
        note.className = 'task-note';
        note.textContent = task.note.split('\n')[0];
        meta.appendChild(note);
      }
      body.appendChild(meta);
    }
    li.appendChild(body);

    if (draggable) {
      var handle = document.createElement('span');
      handle.className = 'task-handle';
      handle.setAttribute('aria-hidden', 'true');
      handle.title = 'ドラッグして移動';
      handle.innerHTML = ICONS.grip;
      li.appendChild(handle);
    }
    return li;
  }

  function render() {
    var rows = buildRows();
    // 並べ替えは全件が見えている「すべて」のときだけ有効にする
    var draggable = state.filter === 'all';
    var fragment = document.createDocumentFragment();
    rows.forEach(function (row) { fragment.appendChild(renderRow(row, draggable)); });
    els.list.replaceChildren(fragment);

    els.empty.hidden = rows.length > 0;
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

    renderAddContext();
  }

  function renderAddContext() {
    var parent = state.addParentId && getTask(state.addParentId);
    if (!parent) state.addParentId = null;
    els.addContext.hidden = !parent;
    els.addContextTitle.textContent = parent ? parent.title : '';
    els.addInput.placeholder = parent ? 'サブタスクを入力' : '新しいタスクを入力';
  }

  // ---- 詳細シート ----

  function fillParentOptions(task) {
    var blockedHeight = subtreeHeight(task.id);
    var kids = groupChildren(state.tasks);
    var options = [new Option('なし（最上位のタスク）', '')];
    function walk(key, depth) {
      (kids[key] || []).forEach(function (t) {
        // 自分自身とそのサブタスクの下には移動できない
        if (t.id === task.id) return;
        var label = new Array(depth + 1).join('　') + (depth > 0 ? '└ ' : '') +
          (t.title.length > 24 ? t.title.slice(0, 24) + '…' : t.title);
        var option = new Option(label, t.id);
        // 移動すると階層の上限を超える場合は選べない
        option.disabled = depth + 1 + blockedHeight > MAX_DEPTH - 1;
        options.push(option);
        walk(t.id, depth + 1);
      });
    }
    walk('', 0);
    els.editParent.replaceChildren.apply(els.editParent, options);
    els.editParent.value = task.parentId || '';
  }

  function openEditor(id) {
    var task = getTask(id);
    if (!task) return;
    state.editingId = id;
    els.editTitle.value = task.title;
    els.editNote.value = task.note;
    fillParentOptions(task);
    els.editAddSub.disabled = depthOf(task) >= MAX_DEPTH - 1;
    if (typeof els.dialog.showModal === 'function') {
      els.dialog.showModal();
    } else {
      els.dialog.setAttribute('open', '');
    }
    // シートを開いた直後にキーボードが出ると操作しにくいので、フォーカスはシート自体に置く
    els.dialog.focus();
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

  // シートの入力内容を保存する。タイトルが空なら保存せず false を返す
  function saveEditor() {
    var id = state.editingId;
    var task = id && getTask(id);
    if (!task) return true;
    var title = normalizeTitle(els.editTitle.value);
    if (!title) {
      els.editTitle.focus();
      return false;
    }
    var note = normalizeNote(els.editNote.value);
    var parentId = els.editParent.value || null;
    if (title !== task.title || note !== task.note) {
      updateTask(id, { title: title, note: note });
    }
    if (parentId !== task.parentId) {
      var siblings = childrenOf(parentId).filter(function (t) { return t.id !== id; });
      moveTask(id, parentId, siblings.length ? siblings[siblings.length - 1].id : null);
    }
    return true;
  }

  // ---- ドラッグ＆ドロップ ----
  // iPhone の Safari は HTML5 の Drag and Drop が使いにくいため Pointer Events で実装する。
  // 右端のつまみを上下に動かすと位置、左右に動かすと階層（親子関係）が変わる。

  var drag = null;

  function startDrag(li, event) {
    var id = li.dataset.id;
    var task = getTask(id);
    if (!task) return;
    var subtree = {};
    subtree[id] = true;
    descendantsOf(id).forEach(function (t) { subtree[t.id] = true; });

    var rows = Array.prototype.slice.call(els.list.children);
    rows.forEach(function (row) {
      if (row !== li && subtree[row.dataset.id]) row.classList.add('is-drag-hidden');
    });
    li.classList.add('is-dragging');
    document.body.classList.add('is-drag-active');

    drag = {
      id: id,
      li: li,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startScroll: window.scrollY,
      startDepth: Number(li.dataset.depth),
      height: subtreeHeight(id),
      others: rows.filter(function (row) { return !subtree[row.dataset.id]; }),
      target: null,
      frame: 0
    };
    updateDrag();
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function updateDrag() {
    var d = drag;
    d.li.style.transform = 'translateY(' + (d.y - d.startY + window.scrollY - d.startScroll) + 'px)';

    // 指の位置から挿入位置（others の何番目の前か）を求める
    var index = 0;
    while (index < d.others.length) {
      var rect = d.others[index].getBoundingClientRect();
      if (d.y < rect.top + rect.height / 2) break;
      index++;
    }
    var prev = d.others[index - 1] || null;
    var next = d.others[index] || null;

    // 挿入できる階層の範囲。前の行の子まで深くでき、次の行より浅くはできない
    var minDepth = next ? Number(next.dataset.depth) : 0;
    var maxDepth = prev ? Number(prev.dataset.depth) + 1 : 0;
    var depth = d.startDepth + Math.round((d.x - d.startX) / INDENT);
    depth = Math.max(minDepth, Math.min(maxDepth, depth));
    // サブタスクごと移動すると階層の上限を超える位置には置けない
    depth = Math.min(depth, MAX_DEPTH - 1 - d.height);

    if (depth < minDepth) {
      d.target = null;
      els.dropIndicator.hidden = true;
      return;
    }

    // 親と直前の兄弟を探す
    var parentId = null;
    var afterId = null;
    for (var i = index - 1; i >= 0; i--) {
      var rowDepth = Number(d.others[i].dataset.depth);
      if (rowDepth === depth && afterId === null) afterId = d.others[i].dataset.id;
      if (rowDepth < depth) {
        parentId = d.others[i].dataset.id;
        break;
      }
    }
    d.target = { parentId: parentId, afterId: afterId };

    var listRect = els.list.getBoundingClientRect();
    var lineY = prev ? prev.getBoundingClientRect().bottom
      : next ? next.getBoundingClientRect().top
      : listRect.top;
    var left = listRect.left + depth * INDENT + 28;
    els.dropIndicator.hidden = false;
    els.dropIndicator.style.top = (lineY - 1) + 'px';
    els.dropIndicator.style.left = left + 'px';
    els.dropIndicator.style.width = Math.max(0, listRect.right - left) + 'px';
  }

  // 画面の上端・下端付近までドラッグしたら自動でスクロールする
  function autoScroll() {
    if (!drag) return;
    var edge = 80;
    var bottomEdge = window.innerHeight - els.addForm.offsetHeight - edge;
    var delta = 0;
    // 端の近くでつまんだだけでは動かさず、端に向かって指を動かしたときだけスクロールする
    if (drag.y < edge && drag.y < drag.startY - 8) {
      delta = -Math.ceil((edge - drag.y) / 6);
    } else if (drag.y > bottomEdge && drag.y > drag.startY + 8) {
      delta = Math.ceil((drag.y - bottomEdge) / 6);
    }
    if (delta) {
      var before = window.scrollY;
      window.scrollBy(0, delta);
      if (window.scrollY !== before) updateDrag();
    }
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function endDrag(apply) {
    var d = drag;
    if (!d) return;
    drag = null;
    cancelAnimationFrame(d.frame);
    els.dropIndicator.hidden = true;
    document.body.classList.remove('is-drag-active');
    if (apply && d.target) {
      moveTask(d.id, d.target.parentId, d.target.afterId);
    } else {
      render();
    }
  }

  els.list.addEventListener('pointerdown', function (e) {
    var handle = e.target.closest('.task-handle');
    if (!handle || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    startDrag(handle.closest('.task'), e);
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
    updateDrag();
  }, { passive: false });

  window.addEventListener('pointerup', function (e) {
    if (drag && e.pointerId === drag.pointerId) endDrag(true);
  });

  window.addEventListener('pointercancel', function (e) {
    if (drag && e.pointerId === drag.pointerId) endDrag(false);
  });

  // ドラッグ中に iOS がページをスクロールしないようにする
  document.addEventListener('touchmove', function (e) {
    if (drag) e.preventDefault();
  }, { passive: false });

  // ---- イベント ----

  els.addInput.addEventListener('input', function () {
    els.addButton.disabled = normalizeTitle(els.addInput.value) === '';
  });

  els.addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var title = normalizeTitle(els.addInput.value);
    if (!title) return;
    if (state.filter === 'done') state.filter = 'all';
    var task = addTask(title, state.addParentId);
    els.addInput.value = '';
    els.addButton.disabled = true;
    // 連続入力しやすいようにフォーカスは入力欄に残す
    els.addInput.focus();
    var added = els.list.querySelector('[data-id="' + task.id + '"]');
    if (added && added.scrollIntoView) added.scrollIntoView({ block: 'nearest' });
  });

  els.addContextClear.addEventListener('click', function () {
    state.addParentId = null;
    renderAddContext();
    els.addInput.focus();
  });

  els.list.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var li = target.closest('.task');
    if (!li) return;
    var id = li.dataset.id;
    var action = target.dataset.action;
    if (action === 'toggle') toggleDone(id);
    else if (action === 'collapse') toggleCollapsed(id);
    else if (action === 'edit') openEditor(id);
  });

  els.filters.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.filter = btn.dataset.filter;
      render();
    });
  });

  els.clearDone.addEventListener('click', function () {
    var done = state.tasks.filter(function (t) { return t.done; });
    if (done.length === 0) return;
    if (window.confirm('完了したタスク ' + done.length + ' 件を削除しますか？')) {
      removeTasks(done.map(function (t) { return t.id; }));
    }
  });

  els.editForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (saveEditor()) closeEditor();
  });

  // タイトル欄では Enter で保存する（日本語入力の変換確定は除く）
  els.editTitle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (saveEditor()) closeEditor();
    }
  });

  els.editCancel.addEventListener('click', closeEditor);

  els.editAddSub.addEventListener('click', function () {
    var id = state.editingId;
    if (!id || !saveEditor()) return;
    closeEditor();
    if (state.filter === 'done') state.filter = 'all';
    state.addParentId = id;
    expand(id);
    commit();
    els.addInput.focus();
  });

  els.editDelete.addEventListener('click', function () {
    var id = state.editingId;
    if (!id) return;
    var count = descendantsOf(id).length;
    var message = count > 0
      ? 'このタスクとサブタスク ' + count + ' 件を削除しますか？'
      : 'このタスクを削除しますか？';
    if (window.confirm(message)) {
      closeEditor();
      removeTasks([id]);
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
    if (e.key === STORAGE_KEY && !drag) {
      state.tasks = loadTasks();
      render();
    }
  });

  render();
})();
