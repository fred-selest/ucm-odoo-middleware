// ═══════════════════════════════════════════════════════════════════════════
// ══ UI HELPERS & UTILS ═════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 'k') { e.preventDefault(); document.getElementById('callSearch')?.focus(); }
  if (e.ctrlKey && e.key === 'd') { e.preventDefault(); toggleTheme(); }
});

// ── Call journal filters ───────────────────────────────────────────────────
let currentFilter = 'all';
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    filterCallRows();
  });
});

function filterCallRows() {
  document.querySelectorAll('#callBody tr, #journalBody tr').forEach(tr => {
    if (tr.querySelector('[colspan]')) return;
    const status = tr.dataset.status || '';
    if (currentFilter === 'all' || status === currentFilter) {
      tr.style.display = '';
    } else {
      tr.style.display = 'none';
    }
  });
}

document.getElementById('callSearch').addEventListener('input', e => {
  const query = e.target.value.toLowerCase();
  document.querySelectorAll('#callBody tr, #journalBody tr').forEach(tr => {
    if (tr.querySelector('[colspan]')) return;
    const text = tr.textContent.toLowerCase();
    tr.style.display = text.includes(query) ? '' : 'none';
  });
});

// ── Click event delegation ─────────────────────────────────────────────────
document.addEventListener('click', e => {
  const phoneEl = e.target.closest('.phone-link');
  if (phoneEl && phoneEl.dataset.phone) { clickPhone(phoneEl.dataset.phone); return; }
  const contactEl = e.target.closest('.contact-badge-clickable');
  if (contactEl && historyContactMap[contactEl.dataset.uid]) {
    showQuickContact(historyContactMap[contactEl.dataset.uid]);
  }
});

async function clickPhone(phone) {
  if (!phone || phone === '—') return;
  try {
    const r = await apiFetch('/api/odoo/test', { method: 'POST', body: JSON.stringify({ phone }) });
    const d = await r.json();
    if (d.ok && d.contact) {
      showQuickContact(d.contact);
    } else {
      openCreateContactModal();
      document.getElementById('newContactPhone').value = phone;
    }
  } catch(e) { console.error('clickPhone error:', e); }
}

// ── Drag & Drop for cards ──────────────────────────────────────────────────
let draggedCard = null;

document.querySelectorAll('.draggable-main-card, .draggable-sub-card').forEach(card => {
  card.addEventListener('dragstart', function(e) {
    draggedCard = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.card);
  });
  
  card.addEventListener('dragend', function() {
    this.classList.remove('dragging');
    draggedCard = null;
    document.querySelectorAll('.draggable-main-card, .draggable-sub-card').forEach(c => c.classList.remove('drag-over'));
    saveCardOrder();
  });
  
  card.addEventListener('dragover', function(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedCard && draggedCard !== this) {
      this.classList.add('drag-over');
    }
  });
  
  card.addEventListener('dragleave', function() {
    this.classList.remove('drag-over');
  });
  
  card.addEventListener('drop', function(e) {
    e.preventDefault();
    this.classList.remove('drag-over');
    
    if (draggedCard && draggedCard !== this) {
      const parent = this.parentElement;
      const cards = [...parent.querySelectorAll('.draggable-main-card, .draggable-sub-card')];
      const fromIndex = cards.indexOf(draggedCard);
      const toIndex = cards.indexOf(this);
      
      if (fromIndex < toIndex) {
        parent.insertBefore(draggedCard, this.nextSibling);
      } else {
        parent.insertBefore(draggedCard, this);
      }
    }
  });
});

function saveCardOrder() {
  const subOrder = [...document.querySelectorAll('.draggable-column .draggable-sub-card')].map(c => c.dataset.card);
  localStorage.setItem('ucm_sub_card_order', JSON.stringify(subOrder));
}

function restoreCardOrder() {
  const savedSubOrder = localStorage.getItem('ucm_sub_card_order');
  if (!savedSubOrder) return;
  
  const order = JSON.parse(savedSubOrder);
  const column = document.querySelector('.draggable-column');
  if (!column) return;
  
  order.forEach(cardId => {
    const card = column.querySelector(`.draggable-sub-card[data-card="${cardId}"]`);
    if (card) {
      column.appendChild(card);
    }
  });
}

setTimeout(restoreCardOrder, 100);
