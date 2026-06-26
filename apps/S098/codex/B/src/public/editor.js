(function () {
  const editor = document.getElementById('editor');
  const saveState = document.getElementById('saveState');
  if (!editor || !saveState) return;

  const documentId = Number(editor.dataset.documentId);
  const canEdit = editor.dataset.role === 'edit';
  const socket = io({ transports: ['websocket', 'polling'] });
  let applyingRemote = false;
  let timer = null;

  socket.emit('join-document', { documentId });

  socket.on('document-state', function (state) {
    if (typeof state.content !== 'string') return;
    applyingRemote = true;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.value = state.content;
    editor.setSelectionRange(Math.min(start, editor.value.length), Math.min(end, editor.value.length));
    applyingRemote = false;
    saveState.textContent = canEdit ? 'Synced' : 'View only';
  });

  if (canEdit) {
    editor.addEventListener('input', function () {
      if (applyingRemote) return;
      saveState.textContent = 'Saving...';
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        socket.emit('document-change', {
          documentId,
          content: editor.value
        });
      }, 180);
    });
  }
}());
