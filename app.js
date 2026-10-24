// ═══════════════════════════════════════════════════════
        //  SUPABASE CONFIGURATION — the publishable key is safe to ship in a
        //  browser app. Protect the table with appropriate Supabase RLS rules.
        // ═══════════════════════════════════════════════════════
        const SUPABASE_URL = 'https://hbvpnslzoulogjivoipv.supabase.co';
        const SUPABASE_ANON_KEY = 'sb_publishable_UTf_89tttlvxQ0N4JAqQaw_iXl7ocpm';
        const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

        async function supabaseRequest(path, options = {}) {
            const headers = {
                apikey: SUPABASE_ANON_KEY,
                ...options.headers,
            };
            // Legacy anon keys are JWTs. New sb_publishable keys use apikey
            // without a Bearer authorization header.
            if (!SUPABASE_ANON_KEY.startsWith('sb_publishable_')) {
                headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
            }
            if (options.body !== undefined) headers['Content-Type'] = 'application/json';

            const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
                method: options.method || 'GET',
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
            });
            const text = await response.text();
            let result = null;
            try {
                result = text ? JSON.parse(text) : null;
            } catch {
                result = { message: text || response.statusText };
            }
            if (!response.ok) {
                const error = new Error(result?.message || result?.details || `Request failed (${response.status})`);
                error.code = result?.code;
                error.status = response.status;
                throw error;
            }
            return result;
        }

        function cloudErrorText(error, action) {
            if (error?.code === '42P01') {
                return `${action} failed: table "invoice_backups" does not exist in Supabase.`;
            }
            if (error?.message) return `${action} failed: ${error.message}`;
            return `${action} failed. Check your connection and Supabase table permissions.`;
        }

        // ─── state ─────────────────────────────────────────────
        const state = {
            items: [],
            nextId: 1,
            taxRate: 0,
            discountRate: 0,
            amountPaid: 0,
            logoData: null,
            logoAspect: 'original',
            logoScale: 100,
            invoiceName: '',
            balanceBoxColor: '#000000',
            isPaid: false,
            paidDate: null,
            prevAmountPaid: null,
        };

        const $ = (id) => document.getElementById(id);

        const invoiceNameInput = $('invoiceName');
        const companyName = $('companyName');
        const companyAddress = $('companyAddress');
        const companyEmail = $('companyEmail');
        const companyPhone = $('companyPhone');
        const clientName = $('clientName');
        const clientAddress = $('clientAddress');
        const clientEmail = $('clientEmail');
        const clientPhone = $('clientPhone');
        const invNumber = $('invNumber');
        const invDate = $('invDate');
        const invDueDate = $('invDueDate');
        const taxRate = $('taxRate');
        const discountRate = $('discountRate');
        const amountPaid = $('amountPaid');
        const notes = $('notes');
        const itemsBody = $('itemsBody');
        const addItemBtn = $('addItemBtn');
        const itemCount = $('itemCount');
        const balanceBoxColorInput = $('balanceBoxColor');

        const editSubtotal = $('editSubtotal');
        const editTax = $('editTax');
        const editDiscount = $('editDiscount');
        const editTotal = $('editTotal');
        const editAmountPaid = $('editAmountPaid');
        const editBalance = $('editBalance');

        const previewContainer = $('invoicePreviewContainer');
        const downloadBtn = $('downloadPdfBtn');

        const logoUpload = $('logoUpload');
        const logoPreview = $('logoPreview');
        const removeLogoBtn = $('removeLogoBtn');
        const logoAspect = $('logoAspect');
        const logoScale = $('logoScale');
        const logoScaleLabel = $('logoScaleLabel');

        const saveIndicator = $('saveIndicator');
        const saveText = $('saveText');
        const historyList = $('historyList');
        const historyBadge = $('historyBadge');
        const toast = $('toast');

        let saveTimeout = null;
        let toastTimeout = null;

        const CURRENCY = '₦';

        // ─── helpers ──────────────────────────────────────────

        function normalizeItems(items) {
            if (!Array.isArray(items)) return [];
            const usedIds = new Set();
            return items.slice(0, 250).map((entry, index) => {
                const candidateId = Number(entry?.id);
                let id = Number.isSafeInteger(candidateId) && candidateId > 0 ? candidateId : index + 1;
                while (usedIds.has(id)) id += 1;
                usedIds.add(id);

                const quantity = Number(entry?.qty);
                const rate = Number(entry?.rate);
                return {
                    id,
                    description: String(entry?.description ?? ''),
                    qty: Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
                    rate: Number.isFinite(rate) ? Math.max(0, rate) : 0,
                };
            });
        }

        function normalizeLogoData(value) {
            if (typeof value !== 'string' || value.length > 500000) return null;
            return /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[a-z0-9+/]+=*$/i.test(value) ? value : null;
        }

        function normalizeColor(value) {
            const color = typeof value === 'string' ? value : '';
            return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color : '#000000';
        }

        function normalizeNextId(value, items) {
            const candidate = Number(value);
            const highestId = items.reduce((highest, item) => Math.max(highest, item.id), 0);
            return Number.isSafeInteger(candidate) && candidate > highestId ? candidate : highestId + 1;
        }

        function formatMoney(amount) {
            let parts = amount.toFixed(2).split('.');
            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            return CURRENCY + parts.join('.');
        }

        function getContrastColor(hexColor) {
            if (!hexColor) return '#ffffff';
            let hex = hexColor.replace('#', '');
            if (hex.length === 3) {
                hex = hex.split('').map(c => c + c).join('');
            }
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? '#000000' : '#ffffff';
        }

        function showToast(message, type = 'info', duration = 3000) {
            toast.textContent = message;
            toast.className = 'toast ' + type;
            clearTimeout(toastTimeout);
            requestAnimationFrame(() => {
                toast.classList.add('show');
            });
            toastTimeout = setTimeout(() => {
                toast.classList.remove('show');
            }, duration);
        }

        function escapeHtml(value) {
            if (value === null || value === undefined) return '';
            return String(value).replace(/[&<>"']/g, (character) => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            })[character]);
        }

        function formatDate(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
        }

        function todayISO() {
            return new Date().toISOString().split('T')[0];
        }

        function computeTotals() {
            const subtotal = state.items.reduce((sum, item) => sum + (item.qty * item.rate), 0);
            const taxVal = (subtotal * (parseFloat(taxRate.value) || 0)) / 100;
            const discountVal = (subtotal * (parseFloat(discountRate.value) || 0)) / 100;
            const total = subtotal + taxVal - discountVal;
            const paid = parseFloat(amountPaid.value) || 0;
            return {
                subtotal,
                taxVal,
                discountVal,
                total,
                paid,
                balance: total - paid,
            };
        }

        // ─── localStorage ──────────────────────────────────────

        function saveState() {
            const data = {
                invoiceName: invoiceNameInput.value,
                companyName: companyName.value,
                companyAddress: companyAddress.value,
                companyEmail: companyEmail.value,
                companyPhone: companyPhone.value,
                clientName: clientName.value,
                clientAddress: clientAddress.value,
                clientEmail: clientEmail.value,
                clientPhone: clientPhone.value,
                invNumber: invNumber.value,
                invDate: invDate.value,
                invDueDate: invDueDate.value,
                taxRate: taxRate.value,
                discountRate: discountRate.value,
                amountPaid: amountPaid.value,
                notes: notes.value,
                items: state.items,
                nextId: state.nextId,
                logoData: state.logoData,
                logoAspect: logoAspect.value,
                logoScale: parseInt(logoScale.value, 10),
                balanceBoxColor: balanceBoxColorInput.value || '#000000',
                isPaid: state.isPaid,
                paidDate: state.paidDate,
                prevAmountPaid: state.prevAmountPaid,
            };
            try {
                localStorage.setItem('invoiceState', JSON.stringify(data));
                showSaveIndicator('Saved', false);
            } catch (e) {
                if (e.name === 'QuotaExceededError' || e.code === 22) {
                    try {
                        const dataWithoutLogo = { ...data, logoData: null };
                        localStorage.setItem('invoiceState', JSON.stringify(dataWithoutLogo));
                        state.logoData = null;
                        updateLogoPreview();
                        showSaveIndicator('Saved (logo removed - storage full)', false);
                    } catch (e2) {
                        showSaveIndicator('Save failed', false);
                    }
                } else {
                    showSaveIndicator('Save failed', false);
                }
            }
        }

        function loadState() {
            try {
                const raw = localStorage.getItem('invoiceState');
                if (!raw) return false;
                const data = JSON.parse(raw);

                invoiceNameInput.value = data.invoiceName || '';
                companyName.value = data.companyName || '';
                companyAddress.value = data.companyAddress || '';
                companyEmail.value = data.companyEmail || '';
                companyPhone.value = data.companyPhone || '';
                clientName.value = data.clientName || '';
                clientAddress.value = data.clientAddress || '';
                clientEmail.value = data.clientEmail || '';
                clientPhone.value = data.clientPhone || '';
                invNumber.value = data.invNumber || '';
                invDate.value = data.invDate || '';
                invDueDate.value = data.invDueDate || '';
                taxRate.value = data.taxRate ?? 0;
                discountRate.value = data.discountRate ?? 0;
                amountPaid.value = data.amountPaid ?? 0;
                notes.value = data.notes || '';

                state.items = normalizeItems(data.items);
                state.nextId = normalizeNextId(data.nextId, state.items);
                state.logoData = normalizeLogoData(data.logoData);
                state.logoAspect = ['original', 'square', 'circle'].includes(data.logoAspect) ? data.logoAspect : 'original';
                state.logoScale = Math.min(400, Math.max(10, Number(data.logoScale) || 100));
                state.balanceBoxColor = normalizeColor(data.balanceBoxColor);
                state.isPaid = !!data.isPaid;
                state.paidDate = data.paidDate || null;
                state.prevAmountPaid = (data.prevAmountPaid === undefined) ? null : data.prevAmountPaid;

                logoAspect.value = state.logoAspect;
                logoScale.value = state.logoScale;
                logoScaleLabel.textContent = state.logoScale + '%';
                balanceBoxColorInput.value = state.balanceBoxColor;

                updateLogoPreview();
                renderItems();
                updateSummary();
                updatePaidButton();
                renderPreview();
                return true;
            } catch (e) {
                return false;
            }
        }

        function showSaveIndicator(text, saving) {
            saveText.textContent = text;
            if (saving) {
                saveIndicator.classList.add('saving');
                saveIndicator.classList.add('visible');
            } else {
                saveIndicator.classList.remove('saving');
                saveIndicator.classList.add('visible');
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(() => {
                    saveIndicator.classList.remove('visible');
                }, 2500);
            }
        }

        function debounceSave() {
            showSaveIndicator('Saving…', true);
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveState();
            }, 300);
        }

        // ─── history ──────────────────────────────────────────

        function getHistory() {
            try {
                const raw = localStorage.getItem('invoiceHistory');
                const history = raw ? JSON.parse(raw) : [];
                return Array.isArray(history)
                    ? history.filter((entry) => entry && typeof entry === 'object' && entry.id !== undefined && entry.data && typeof entry.data === 'object')
                    : [];
            } catch {
                return [];
            }
        }

        function setHistory(history) {
            localStorage.setItem('invoiceHistory', JSON.stringify(history));
            renderHistory();
        }

        function saveToHistory() {
            const data = collectData();
            const hasContent = state.items.length > 0 || data.company.name || data.client.name;
            if (!hasContent) {
                showToast('Nothing to save — invoice is empty.', 'info');
                return false;
            }

            const history = getHistory();
            const name = data.invoice.name || (data.company.name || 'Unnamed') + ' — ' + (data.invoice.number || 'Draft');

            const snapshot = {
                invoiceName: invoiceNameInput.value,
                companyName: companyName.value,
                companyAddress: companyAddress.value,
                companyEmail: companyEmail.value,
                companyPhone: companyPhone.value,
                clientName: clientName.value,
                clientAddress: clientAddress.value,
                clientEmail: clientEmail.value,
                clientPhone: clientPhone.value,
                invNumber: invNumber.value,
                invDate: invDate.value,
                invDueDate: invDueDate.value,
                taxRate: taxRate.value,
                discountRate: discountRate.value,
                amountPaid: amountPaid.value,
                notes: notes.value,
                items: JSON.parse(JSON.stringify(state.items)),
                nextId: state.nextId,
                logoData: state.logoData,
                logoAspect: logoAspect.value,
                logoScale: parseInt(logoScale.value, 10),
                balanceBoxColor: balanceBoxColorInput.value || '#000000',
                isPaid: state.isPaid,
                paidDate: state.paidDate,
                prevAmountPaid: state.prevAmountPaid,
            };

            history.unshift({
                id: 'hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: name,
                timestamp: Date.now(),
                data: snapshot,
            });

            setHistory(history);
            showToast('Invoice saved to history ✓', 'success');
            return true;
        }

        function loadFromHistory(id) {
            const history = getHistory();
            const entry = history.find(h => String(h.id) === String(id));
            if (!entry) {
                showToast('Invoice not found.', 'error');
                return;
            }

            const d = entry.data;

            invoiceNameInput.value = d.invoiceName || '';
            companyName.value = d.companyName || '';
            companyAddress.value = d.companyAddress || '';
            companyEmail.value = d.companyEmail || '';
            companyPhone.value = d.companyPhone || '';
            clientName.value = d.clientName || '';
            clientAddress.value = d.clientAddress || '';
            clientEmail.value = d.clientEmail || '';
            clientPhone.value = d.clientPhone || '';
            invNumber.value = d.invNumber || '';
            invDate.value = d.invDate || '';
            invDueDate.value = d.invDueDate || '';
            taxRate.value = d.taxRate ?? 0;
            discountRate.value = d.discountRate ?? 0;
            amountPaid.value = d.amountPaid ?? 0;
            notes.value = d.notes || '';

            state.items = normalizeItems(d.items);
            state.nextId = normalizeNextId(d.nextId, state.items);
            state.logoData = normalizeLogoData(d.logoData);
            state.logoAspect = ['original', 'square', 'circle'].includes(d.logoAspect) ? d.logoAspect : 'original';
            state.logoScale = Math.min(400, Math.max(10, Number(d.logoScale) || 100));
            state.balanceBoxColor = normalizeColor(d.balanceBoxColor);
            state.isPaid = !!d.isPaid;
            state.paidDate = d.paidDate || null;
            state.prevAmountPaid = (d.prevAmountPaid === undefined) ? null : d.prevAmountPaid;

            logoAspect.value = state.logoAspect;
            logoScale.value = state.logoScale;
            logoScaleLabel.textContent = state.logoScale + '%';
            balanceBoxColorInput.value = state.balanceBoxColor;

            updateLogoPreview();
            renderItems();
            updateSummary();
            updatePaidButton();
            renderPreview();
            debounceSave();

            switchTab('edit-tab');
            showToast('Invoice loaded for editing ✓', 'success');
        }

        function duplicateHistory(id) {
            const history = getHistory();
            const entry = history.find(h => String(h.id) === String(id));
            if (!entry) {
                showToast('Invoice not found.', 'error');
                return;
            }

            const d = entry.data;
            const newName = (d.invoiceName || d.companyName || 'Unnamed') + ' (copy)';

            const snapshot = {
                invoiceName: d.invoiceName || '',
                companyName: d.companyName || '',
                companyAddress: d.companyAddress || '',
                companyEmail: d.companyEmail || '',
                companyPhone: d.companyPhone || '',
                clientName: d.clientName || '',
                clientAddress: d.clientAddress || '',
                clientEmail: d.clientEmail || '',
                clientPhone: d.clientPhone || '',
                invNumber: d.invNumber || '',
                invDate: d.invDate || '',
                invDueDate: d.invDueDate || '',
                taxRate: d.taxRate ?? 0,
                discountRate: d.discountRate ?? 0,
                amountPaid: d.amountPaid ?? 0,
                notes: d.notes || '',
                items: JSON.parse(JSON.stringify(d.items || [])),
                nextId: d.nextId || 1,
                logoData: d.logoData || null,
                logoAspect: d.logoAspect || 'original',
                logoScale: d.logoScale || 100,
                balanceBoxColor: d.balanceBoxColor || '#000000',
                isPaid: !!d.isPaid,
                paidDate: d.paidDate || null,
                prevAmountPaid: (d.prevAmountPaid === undefined) ? null : d.prevAmountPaid,
            };

            history.unshift({
                id: 'hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                name: newName,
                timestamp: Date.now(),
                data: snapshot,
            });

            setHistory(history);
            showToast('Invoice duplicated ✓', 'success');
        }

        function deleteHistory(id) {
            if (!confirm('Delete this invoice from history?')) return;
            let history = getHistory();
            history = history.filter(h => String(h.id) !== String(id));
            setHistory(history);
            showToast('Invoice deleted.', 'info');
        }

        function clearAllHistory() {
            if (!confirm('Delete all invoices from history?')) return;
            setHistory([]);
            showToast('All history cleared.', 'info');
        }

        function renameHistory(id, newName) {
            let history = getHistory();
            const entry = history.find(h => String(h.id) === String(id));
            if (entry) {
                entry.name = newName.trim() || 'Unnamed';
                setHistory(history);
                showToast('Renamed ✓', 'success');
            }
        }

        function startRename(id) {
            const item = Array.from(document.querySelectorAll('.history-item')).find((element) => element.dataset.id === String(id));
            if (!item) return;
            const nameSpan = item.querySelector('.name');
            if (!nameSpan) return;
            const currentName = nameSpan.textContent;

            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentName;
            input.className = 'rename-input';
            input.setAttribute('aria-label', 'Rename invoice');

            const saveRename = () => {
                const newName = input.value.trim() || 'Unnamed';
                renameHistory(id, newName);
            };

            input.addEventListener('blur', saveRename);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    input.blur();
                }
                if (e.key === 'Escape') {
                    input.value = currentName;
                    input.blur();
                }
            });

            nameSpan.replaceWith(input);
            input.focus();
            input.select();
        }

        function renderHistory() {
            const history = getHistory();
            historyBadge.textContent = history.length;

            if (history.length === 0) {
                historyList.innerHTML = `
                    <div class="history-empty">
                        <div class="icon"><i class="fas fa-folder-open fa-icon" aria-hidden="true"></i></div>
                        <p>No invoices saved yet.</p>
                        <p style="font-size:13px;margin-top:4px;">Click the <strong>+</strong> button to save the current invoice.</p>
                    </div>
                `;
                return;
            }

            const html = history.map((entry) => {
                const date = new Date(entry.timestamp);
                const dateStr = date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                });
                const id = escapeHtml(String(entry.id));
                const paidChip = entry.data && entry.data.isPaid
                    ? '<span class="paid-chip"><i class="fas fa-check-circle fa-icon" aria-hidden="true"></i> Paid</span>'
                    : '';
                return `
                    <div class="history-item" data-id="${id}">
                        <div class="info">
                            <span class="name">${escapeHtml(entry.name)} ${paidChip}</span>
                            <span class="meta">${escapeHtml(dateStr)}</span>
                        </div>
                        <div class="actions">
                            <button type="button" class="btn-sm duplicate" data-action="duplicate" data-id="${id}"><i class="fas fa-copy fa-icon" aria-hidden="true"></i> Duplicate</button>
                            <button type="button" class="btn-sm edit" data-action="edit" data-id="${id}"><i class="fas fa-pen fa-icon" aria-hidden="true"></i> Edit</button>
                            <button type="button" class="btn-sm rename" data-action="rename" data-id="${id}"><i class="fas fa-pencil fa-icon" aria-hidden="true"></i> Rename</button>
                            <button type="button" class="btn-sm delete" data-action="delete" data-id="${id}"><i class="fas fa-trash fa-icon" aria-hidden="true"></i> Delete</button>
                        </div>
                    </div>
                `;
            }).join('');

            historyList.innerHTML = html;
            historyList.querySelectorAll('button[data-action]').forEach((button) => {
                button.addEventListener('click', () => {
                    const { action, id } = button.dataset;
                    if (action === 'duplicate') duplicateHistory(id);
                    else if (action === 'edit') loadFromHistory(id);
                    else if (action === 'rename') startRename(id);
                    else if (action === 'delete') deleteHistory(id);
                });
            });
        }

        // ─── logo ─────────────────────────────────────────────

        function updateLogoPreview() {
            const preview = logoPreview;
            const placeholder = preview.querySelector('.placeholder');
            const img = preview.querySelector('img');
            const removeBtn = removeLogoBtn;

            if (img) img.remove();

            if (state.logoData) {
                const newImg = document.createElement('img');
                newImg.src = state.logoData;
                newImg.alt = 'Logo';
                preview.prepend(newImg);
                preview.classList.add('has-logo');
                if (placeholder) placeholder.style.display = 'none';
                removeBtn.style.display = 'flex';
            } else {
                preview.classList.remove('has-logo');
                if (placeholder) placeholder.style.display = 'flex';
                removeBtn.style.display = 'none';
            }
            renderPreview();
        }

        function handleLogoUpload(file) {
            if (!file) return;
            if (file.size > 1024 * 1024) {
                showToast('Logo is large (>1MB). Using smaller image for performance.', 'info');
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                const dataUrl = e.target.result;
                const img = new Image();
                img.onload = function() {
                    let width = img.width;
                    let height = img.height;
                    const maxSize = 200;
                    if (width > maxSize || height > maxSize) {
                        const ratio = Math.min(maxSize / width, maxSize / height);
                        width = Math.round(width * ratio);
                        height = Math.round(height * ratio);
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img, 0, 0, width, height);
                    const compressed = canvas.toDataURL('image/jpeg', 0.8);
                    state.logoData = compressed;
                    updateLogoPreview();
                    debounceSave();
                    showToast('Logo uploaded ✓', 'success');
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        }

        function removeLogo() {
            state.logoData = null;
            updateLogoPreview();
            debounceSave();
            showToast('Logo removed.', 'info');
        }

        // ─── items ────────────────────────────────────────────

        function addItem(desc = '', qty = 1, rate = 0) {
            state.items.push({
                id: state.nextId++,
                description: desc,
                qty: qty,
                rate: rate
            });
            renderItems();
            updateSummary();
            renderPreview();
            debounceSave();
        }

        function removeItem(id) {
            if (state.items.length <= 1) {
                showToast('At least one line item is required.', 'info');
                return;
            }
            state.items = state.items.filter(item => item.id !== id);
            renderItems();
            updateSummary();
            renderPreview();
            debounceSave();
        }

        function renderItems() {
            if (!itemsBody) return;
            let html = '';
            state.items.forEach((item) => {
                const amount = (item.qty * item.rate);
                html += `
                            <tr data-id="${item.id}">
                                <td class="col-desc">
                                    <input type="text" class="item-desc" value="${escapeHtml(item.description)}" placeholder="Description" inputmode="text" />
                                </td>
                                <td class="col-qty">
                                    <input type="number" class="item-qty" value="${item.qty}" min="0" step="1" inputmode="decimal" />
                                </td>
                                <td class="col-rate">
                                    <input type="number" class="item-rate" value="${item.rate}" min="0" step="0.5" inputmode="decimal" />
                                </td>
                                <td class="col-amount">
                                    <span class="amount-display">${formatMoney(amount)}</span>
                                </td>
                                <td class="col-action">
                                    <button class="btn-remove-item" data-id="${item.id}" title="Remove"><i class="fas fa-times fa-icon"></i></button>
                                </td>
                            </tr>
                        `;
            });
            itemsBody.innerHTML = html;
            itemCount.textContent = state.items.length + ' items';

            itemsBody.querySelectorAll('.item-desc').forEach((el, i) => {
                el.addEventListener('input', () => {
                    state.items[i].description = el.value;
                    renderPreview();
                    debounceSave();
                });
            });

            itemsBody.querySelectorAll('.item-qty').forEach((el, i) => {
                el.addEventListener('input', () => {
                    const val = parseFloat(el.value) || 0;
                    state.items[i].qty = val;
                    updateRowAmount(i);
                    updateSummary();
                    renderPreview();
                    debounceSave();
                });
            });

            itemsBody.querySelectorAll('.item-rate').forEach((el, i) => {
                el.addEventListener('input', () => {
                    const val = parseFloat(el.value) || 0;
                    state.items[i].rate = val;
                    updateRowAmount(i);
                    updateSummary();
                    renderPreview();
                    debounceSave();
                });
            });

            itemsBody.querySelectorAll('.btn-remove-item').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = parseInt(btn.dataset.id);
                    removeItem(id);
                });
            });
        }

        function updateRowAmount(index) {
            const item = state.items[index];
            if (!item) return;
            const row = itemsBody.querySelector(`tr[data-id="${item.id}"]`);
            if (!row) return;
            const display = row.querySelector('.amount-display');
            if (display) {
                display.textContent = formatMoney(item.qty * item.rate);
            }
        }

        function updateSummary() {
            const t = computeTotals();

            editSubtotal.textContent = formatMoney(t.subtotal);
            editTax.textContent = formatMoney(t.taxVal);
            editDiscount.textContent = formatMoney(t.discountVal);
            editTotal.textContent = formatMoney(t.total);
            editAmountPaid.textContent = formatMoney(t.paid);
            editBalance.textContent = formatMoney(t.balance);
        }

        // ─── paid / receipt toggle ────────────────────────────

        function updatePaidButton() {
            const buttons = document.querySelectorAll('.btn-paid-toggle');
            buttons.forEach(btn => {
                if (state.isPaid) {
                    btn.classList.add('active');
                    btn.innerHTML = '<i class="fas fa-undo fa-icon"></i> Undo payment';
                    btn.title = 'Undo payment and go back to invoice view';
                } else {
                    btn.classList.remove('active');
                    btn.innerHTML = '<i class="fas fa-check-circle fa-icon"></i> Mark as paid';
                    btn.title = 'Mark this invoice as paid and switch to receipt view';
                }
            });
        }

        function togglePaid() {
            if (!state.isPaid) {
                // Mark as paid → switch preview to receipt
                const t = computeTotals();
                state.prevAmountPaid = amountPaid.value;
                if (t.paid < t.total) {
                    amountPaid.value = t.total.toFixed(2);
                }
                state.isPaid = true;
                state.paidDate = todayISO();

                updateSummary();
                updatePaidButton();
                renderPreview();
                debounceSave();

                showToast('Marked as paid — receipt ready ✓', 'success');
                if (currentTabId() !== 'preview-tab') {
                    switchTab('preview-tab');
                }
            } else {
                // Undo payment → back to invoice
                state.isPaid = false;
                if (state.prevAmountPaid !== null && state.prevAmountPaid !== undefined && state.prevAmountPaid !== '') {
                    amountPaid.value = state.prevAmountPaid;
                } else {
                    amountPaid.value = 0;
                }
                state.paidDate = null;
                state.prevAmountPaid = null;

                updateSummary();
                updatePaidButton();
                renderPreview();
                debounceSave();

                showToast('Payment undone — back to invoice.', 'info');
            }
        }

        function currentTabId() {
            const active = document.querySelector('.tab-btn.active');
            return active ? active.dataset.tab : 'edit-tab';
        }

        // ─── preview ──────────────────────────────────────────

        function renderPreview() {
            const data = collectData();
            const html = buildInvoiceHtml(data);
            previewContainer.innerHTML = html;
        }

        function collectData() {
            const t = computeTotals();

            return {
                company: {
                    name: companyName.value || '',
                    address: companyAddress.value || '',
                    email: companyEmail.value || '',
                    phone: companyPhone.value || '',
                },
                client: {
                    name: clientName.value || '',
                    address: clientAddress.value || '',
                    email: clientEmail.value || '',
                    phone: clientPhone.value || '',
                },
                invoice: {
                    name: invoiceNameInput.value || '',
                    number: invNumber.value || '',
                    date: invDate.value ? formatDate(invDate.value) : '',
                    dueDate: invDueDate.value ? formatDate(invDueDate.value) : '',
                },
                items: state.items.map(item => ({
                    description: item.description || '—',
                    qty: item.qty || 0,
                    rate: item.rate || 0,
                    amount: (item.qty || 0) * (item.rate || 0),
                })),
                subtotal: t.subtotal,
                tax: t.taxVal,
                taxRate: parseFloat(taxRate.value) || 0,
                discount: t.discountVal,
                discountRate: parseFloat(discountRate.value) || 0,
                total: t.total,
                amountPaid: t.paid,
                balance: t.balance,
                notes: notes.value || '',
                logo: state.logoData,
                logoAspect: state.logoAspect,
                logoScale: state.logoScale,
                balanceBoxColor: state.balanceBoxColor || '#000000',
                isPaid: state.isPaid,
                paidDate: state.paidDate ? formatDate(state.paidDate) : '',
            };
        }

        function buildInvoiceHtml(d) {
            const isReceipt = !!d.isPaid;
            const hasLogo = d.logo && d.logo.length > 0;
            const scale = d.logoScale / 100;
            const baseSize = 70;
            const size = baseSize * scale;

            let logoStyle = '';
            if (hasLogo) {
                const bgProps = `background-image: url('${d.logo}'); background-size: contain; background-repeat: no-repeat; background-position: center;`;

                if (d.logoAspect === 'circle') {
                    logoStyle =
                        `width: ${size}px; height: ${size}px; border-radius: 50%; display: block; flex-shrink: 0; border: none; outline: none; background-color: transparent; ${bgProps}`;
                } else if (d.logoAspect === 'square') {
                    logoStyle =
                        `width: ${size}px; height: ${size}px; display: block; flex-shrink: 0; border: none; outline: none; background-color: transparent; ${bgProps}`;
                } else {
                    logoStyle =
                        `width: ${size}px; height: ${size}px; display: block; flex-shrink: 0; border: none; outline: none; background-color: transparent; ${bgProps}`;
                }
            }

            const logoHtml = hasLogo ? `<div class="logo-wrap" style="${logoStyle}"></div>` : '';

            const itemsRows = d.items.map(item => `
                            <tr>
                                <td>${escapeHtml(item.description)}</td>
                                <td style="text-align:left;">${item.qty}</td>
                                <td style="text-align:left;">${formatMoney(item.rate)}</td>
                                <td>${formatMoney(item.amount)}</td>
                            </tr>
                        `).join('');

            const companyNameHtml = d.company.name ? `<h2>${escapeHtml(d.company.name)}</h2>` : '';

            // ── summary lines ──
            let summaryLines = `
                            <div class="sum-line">
                                <span>Subtotal</span>
                                <span>${formatMoney(d.subtotal)}</span>
                            </div>
                        `;
            if (d.taxRate > 0) {
                summaryLines += `
                            <div class="sum-line">
                                <span>Tax (${d.taxRate}%)</span>
                                <span>${formatMoney(d.tax)}</span>
                            </div>
                        `;
            }
            if (d.discountRate > 0) {
                summaryLines += `
                            <div class="sum-line">
                                <span>Discount (${d.discountRate}%)</span>
                                <span>-${formatMoney(d.discount)}</span>
                            </div>
                        `;
            }
            summaryLines += `
                            <div class="sum-line total">
                                <span>Total</span>
                                <span>${formatMoney(d.total)}</span>
                            </div>
                        `;

            if (isReceipt) {
                summaryLines += `
                            <div class="sum-line paid">
                                <span>Amount paid</span>
                                <span>${formatMoney(d.total)}</span>
                            </div>
                            <div class="sum-line balance">
                                <span>Balance due</span>
                                <span>${formatMoney(0)}</span>
                            </div>
                        `;
            } else {
                if (d.amountPaid > 0) {
                    summaryLines += `
                            <div class="sum-line paid">
                                <span>Amount paid</span>
                                <span>${formatMoney(d.amountPaid)}</span>
                            </div>
                        `;
                }
                summaryLines += `
                            <div class="sum-line balance">
                                <span>Balance due</span>
                                <span>${formatMoney(d.balance)}</span>
                            </div>
                        `;
            }

            const boxColor = d.balanceBoxColor || '#000000';
            const boxTextColor = getContrastColor(boxColor);
            const boxLabel = isReceipt ? 'PAID IN FULL' : 'BALANCE DUE';
            const boxAmount = isReceipt ? formatMoney(d.total) : formatMoney(d.balance);

            const docTitle = isReceipt ? 'RECEIPT' : 'INVOICE';

            const topRow = `
                        <div class="inv-row-top">
                            <div class="inv-logo-area">
                                ${logoHtml}
                            </div>
                            <div class="inv-title-wrap">
                                <div class="inv-title">${docTitle}</div>
                                ${isReceipt ? '<div class="paid-stamp"><i class="fas fa-check-circle fa-icon"></i> Paid</div>' : ''}
                            </div>
                        </div>
                    `;

            const bottomRow = `
                        <div class="inv-row-bottom">
                            <div class="brand-text">
                                ${companyNameHtml}
                                ${d.company.address ? `<div class="sub">${escapeHtml(d.company.address)}</div>` : ''}
                                ${d.company.email ? `<div class="sub">${escapeHtml(d.company.email)}</div>` : ''}
                                ${d.company.phone ? `<div class="sub">${escapeHtml(d.company.phone)}</div>` : ''}
                                ${!d.company.name && !d.company.address && !d.company.email && !d.company.phone ? '<div class="sub" style="color:#94a3b8;">—</div>' : ''}
                            </div>
                            <div class="balance-box" style="background-color: ${boxColor}; color: ${boxTextColor};">
                                <div class="balance-label">${boxLabel}</div>
                                <div class="balance-amount">${boxAmount}</div>
                            </div>
                        </div>
                    `;

            const invHeader = `
                        <div class="inv-header">
                            ${topRow}
                            ${bottomRow}
                        </div>
                    `;

            const detailsTitle = isReceipt ? 'Receipt details' : 'Invoice details';
            const detailsBlock = `
                                    <div class="party" style="text-align:right;">
                                        <h4>${detailsTitle}</h4>
                                        ${d.invoice.number ? `<p><strong>#</strong> ${escapeHtml(d.invoice.number)}</p>` : ''}
                                        ${d.invoice.date ? `<p><strong>Date</strong> ${d.invoice.date}</p>` : ''}
                                        ${d.invoice.dueDate ? `<p><strong>Due</strong> ${d.invoice.dueDate}</p>` : ''}
                                        ${isReceipt && d.paidDate ? `<p><strong>Paid</strong> ${d.paidDate}</p>` : ''}
                                        ${!d.invoice.number && !d.invoice.date && !d.invoice.dueDate && !(isReceipt && d.paidDate) ? '<p style="color:#94a3b8;">—</p>' : ''}
                                    </div>
                                `;

            return `
                            <div class="invoice-preview${isReceipt ? ' receipt' : ''}" id="invoiceToPdf">
                                ${invHeader}

                                <div class="inv-parties">
                                    <div class="party">
                                        <h4>Bill to</h4>
                                        ${d.client.name ? `<p class="name">${escapeHtml(d.client.name)}</p>` : ''}
                                        ${d.client.address ? `<p>${escapeHtml(d.client.address)}</p>` : ''}
                                        ${d.client.email ? `<p>${escapeHtml(d.client.email)}</p>` : ''}
                                        ${d.client.phone ? `<p>${escapeHtml(d.client.phone)}</p>` : ''}
                                        ${!d.client.name && !d.client.address && !d.client.email && !d.client.phone ? '<p style="color:#94a3b8;">—</p>' : ''}
                                    </div>
                                    ${detailsBlock}
                                </div>

                                <table class="inv-items">
                                    <thead>
                                        <tr>
                                            <th>Description</th>
                                            <th style="text-align:left;">Qty</th>
                                            <th style="text-align:left;">Rate</th>
                                            <th style="text-align:right;">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${itemsRows || `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:24px 0;">No items</td></tr>`}
                                    </tbody>
                                </table>

                                <div class="inv-summary">
                                    ${summaryLines}
                                </div>

                                ${isReceipt ? `
                                        <div class="receipt-thanks">
                                            <i class="fas fa-check-circle fa-icon"></i>
                                            <span>Payment received with thanks. This receipt confirms that the balance above has been settled in full.</span>
                                        </div>
                                    ` : ''}

                                ${d.notes ? `
                                        <div class="inv-notes">
                                            <strong>Notes</strong>
                                            <p>${escapeHtml(d.notes)}</p>
                                        </div>
                                    ` : ''}
                            </div>
                        `;
        }

        // ─── PDF download ─────────────────────────────────────

        function setupDownload() {
            downloadBtn.addEventListener('click', async () => {
                const element = document.getElementById('invoiceToPdf');
                if (!element) {
                    showToast('Please add some items to generate a PDF.', 'error');
                    return;
                }

                const originalText = downloadBtn.innerHTML;
                downloadBtn.innerHTML = '⏳ Generating…';
                downloadBtn.disabled = true;

                try {
                    const clone = element.cloneNode(true);
                    clone.style.padding = '48px 48px 40px';
                    clone.style.backgroundColor = '#ffffff';
                    clone.style.borderRadius = '0';
                    clone.style.border = 'none';
                    clone.style.boxShadow = 'none';
                    clone.style.margin = '0';
                    clone.style.width = '100%';
                    clone.style.maxWidth = '100%';
                    clone.style.boxSizing = 'border-box';
                    clone.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
                    clone.style.color = '#1e293b';
                    clone.style.fontSize = '14px';
                    clone.style.lineHeight = '1.6';

                    const imgs = clone.querySelectorAll('img');
                    await Promise.all(Array.from(imgs).map(img => {
                        return new Promise((resolve) => {
                            if (img.complete && img.naturalWidth > 0) resolve();
                            else {
                                img.onload = resolve;
                                img.onerror = resolve;
                            }
                            if (img.src && !img.complete) {
                                // already loading
                            } else if (img.src) {
                                resolve();
                            } else {
                                resolve();
                            }
                        });
                    }));

                    const container = document.createElement('div');
                    container.style.position = 'fixed';
                    container.style.left = '-9999px';
                    container.style.top = '0';
                    container.style.width = '794px';
                    container.style.backgroundColor = '#ffffff';
                    container.style.padding = '0';
                    container.style.margin = '0';
                    container.style.boxSizing = 'border-box';
                    container.appendChild(clone);
                    document.body.appendChild(container);

                    await new Promise(r => requestAnimationFrame(r));
                    await new Promise(r => setTimeout(r, 150));

                    const height = Math.max(clone.scrollHeight + 30, 400);
                    const width = 794;

                    const filePrefix = state.isPaid ? 'receipt' : 'invoice';

                    const opt = {
                        margin: [0, 0, 0, 0],
                        filename: `${filePrefix}-${invNumber.value || 'draft'}.pdf`,
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: {
                            scale: 2,
                            useCORS: true,
                            logging: false,
                            width: width,
                            height: height,
                            windowHeight: height,
                            scrollY: 0,
                            scrollX: 0,
                            windowWidth: width,
                        },
                        jsPDF: {
                            unit: 'px',
                            format: [width, height],
                            orientation: 'portrait',
                            compress: true,
                        },
                        pagebreak: { mode: 'avoid-all' }
                    };

                    await html2pdf().set(opt).from(clone).save();
                    document.body.removeChild(container);
                    showToast(state.isPaid ? 'Receipt PDF downloaded ✓' : 'PDF downloaded ✓', 'success');

                } catch (err) {
                    console.error(err);
                    showToast('Could not generate PDF. Please try again.', 'error');
                } finally {
                    downloadBtn.innerHTML = originalText;
                    downloadBtn.disabled = false;
                }
            });
        }

        // ─── tabs ─────────────────────────────────────────────

        function switchTab(tabId) {
            const tabs = document.querySelectorAll('.tab-btn');
            const contents = {
                'edit-tab': document.getElementById('edit-tab'),
                'preview-tab': document.getElementById('preview-tab'),
                'history-tab': document.getElementById('history-tab'),
                'backup-tab': document.getElementById('backup-tab'),
            };

            tabs.forEach((button) => {
                const selected = button.dataset.tab === tabId;
                button.classList.toggle('active', selected);
                button.setAttribute('aria-selected', String(selected));
                button.tabIndex = selected ? 0 : -1;
            });
            Object.keys(contents).forEach(key => {
                contents[key].classList.toggle('active', key === tabId);
            });

            if (tabId === 'preview-tab') renderPreview();
            if (tabId === 'history-tab') renderHistory();
        }

        function setupTabs() {
            const tabs = document.querySelectorAll('.tab-btn');
            tabs.forEach((button, index) => {
                button.addEventListener('click', () => {
                    switchTab(button.dataset.tab);
                });
                button.addEventListener('keydown', (event) => {
                    let nextIndex = index;
                    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
                    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
                    else if (event.key === 'Home') nextIndex = 0;
                    else if (event.key === 'End') nextIndex = tabs.length - 1;
                    else return;

                    event.preventDefault();
                    tabs[nextIndex].focus();
                    switchTab(tabs[nextIndex].dataset.tab);
                });
            });
        }

        // ─── plus / reset ──────────────────────────────────────

        function handlePlus() {
            const hasContent = state.items.length > 0 ||
                companyName.value.trim() ||
                clientName.value.trim() ||
                invNumber.value.trim();

            if (hasContent) {
                const saved = saveToHistory();
                if (!saved) return;
            } else {
                showToast('Nothing to save — invoice is empty.', 'info');
                return;
            }

            resetInvoiceData(true);
            showToast('New invoice created ✓', 'success');
        }

        function resetInvoiceData(silent = false) {
            state.items = [];
            state.nextId = 1;
            state.logoData = null;
            state.logoAspect = 'original';
            state.logoScale = 100;
            state.balanceBoxColor = '#000000';
            state.isPaid = false;
            state.paidDate = null;
            state.prevAmountPaid = null;

            logoAspect.value = 'original';
            logoScale.value = 100;
            logoScaleLabel.textContent = '100%';
            balanceBoxColorInput.value = '#000000';

            invoiceNameInput.value = '';
            companyName.value = '';
            companyAddress.value = '';
            companyEmail.value = '';
            companyPhone.value = '';
            clientName.value = '';
            clientAddress.value = '';
            clientEmail.value = '';
            clientPhone.value = '';
            invNumber.value = '';
            const today = new Date().toISOString().split('T')[0];
            invDate.value = today;
            const due = new Date();
            due.setDate(due.getDate() + 30);
            invDueDate.value = due.toISOString().split('T')[0];
            taxRate.value = 0;
            discountRate.value = 0;
            amountPaid.value = 0;
            notes.value = '';

            addItem('', 1, 0);
            updateLogoPreview();
            renderItems();
            updateSummary();
            updatePaidButton();
            renderPreview();
            if (!silent) debounceSave();
        }

        function resetInvoice() {
            if (!confirm('Reset all invoice data? Unsaved changes will be lost.')) return;
            resetInvoiceData(false);
            showToast('Invoice reset.', 'info');
        }
        window.resetInvoice = resetInvoice;

        // ─── local backup ──────────────────────────────────────

        function downloadBackup() {
            const data = {
                invoiceState: localStorage.getItem('invoiceState'),
                invoiceHistory: localStorage.getItem('invoiceHistory'),
                version: '1.0',
                exportedAt: new Date().toISOString(),
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `invoice_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Backup downloaded ✓', 'success');
        }

        function restoreBackup(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.invoiceState) localStorage.setItem('invoiceState', data.invoiceState);
                    if (data.invoiceHistory) localStorage.setItem('invoiceHistory', data.invoiceHistory);
                    showToast('Backup restored ✓ Reloading...', 'success');
                    setTimeout(() => location.reload(), 1200);
                } catch (err) {
                    showToast('Invalid backup file.', 'error');
                }
            };
            reader.readAsText(file);
        }

        // ─── CLOUD BACKUP (Supabase) ──────────────────────────

        let cloudModalMode = 'upload'; // 'upload' | 'load'

        function openCloudModal(mode) {
            cloudModalMode = mode;
            const modal = $('cloudModal');
            const title = $('cloudModalTitle');
            const sub = $('cloudModalSub');
            const actionBtn = $('cloudModalActionBtn');
            const accessGroup = $('cloudAccessCodeGroup');
            const status = $('cloudModalStatus');

            status.className = 'modal-status';
            status.textContent = '';
            status.style.display = 'none';

            if (mode === 'upload') {
                title.innerHTML = '<i class="fas fa-cloud-upload-alt fa-icon"></i> Upload to Cloud';
                sub.textContent = 'Enter your username and access code to save this invoice to the cloud.';
                actionBtn.innerHTML = '<i class="fas fa-cloud-upload-alt fa-icon"></i> Upload';
                accessGroup.style.display = 'block';
            } else {
                title.innerHTML = '<i class="fas fa-cloud-download-alt fa-icon"></i> Load from Cloud';
                sub.textContent = 'Enter your username to restore your invoices from the cloud.';
                actionBtn.innerHTML = '<i class="fas fa-cloud-download-alt fa-icon"></i> Load';
                accessGroup.style.display = 'none';
            }

            $('cloudUsernameInput').value = '';
            $('cloudAccessCodeInput').value = '';
            modal.classList.add('active');
            setTimeout(() => $('cloudUsernameInput').focus(), 100);
        }

        function closeCloudModal() {
            $('cloudModal').classList.remove('active');
        }

        function setCloudModalStatus(message, type = 'info') {
            const status = $('cloudModalStatus');
            status.textContent = message;
            status.className = 'modal-status show ' + type;
            status.style.display = 'block';
        }

        function clearCloudModalStatus() {
            const status = $('cloudModalStatus');
            status.className = 'modal-status';
            status.textContent = '';
            status.style.display = 'none';
        }

        function updateCloudStatusBadge(connected, message) {
            const el = $('cloudStatus');
            const dot = $('cloudStatusDot');
            const text = $('cloudStatusText');
            if (connected) {
                el.style.display = 'inline-flex';
                dot.className = 'dot green';
                text.textContent = message || 'Connected to Supabase';
            } else if (connected === false) {
                el.style.display = 'inline-flex';
                dot.className = 'dot red';
                text.textContent = message || 'Not connected';
            } else {
                el.style.display = 'none';
            }
        }

        // ─── cloud upload ──────────────────────────────────────

        async function cloudUpload(username, accessCode) {
            if (!supabaseReady) {
                setCloudModalStatus('Supabase is not configured for this app.', 'error');
                return false;
            }
            if (!username.trim()) {
                setCloudModalStatus('Please enter a username.', 'error');
                return false;
            }
            if (!accessCode.trim()) {
                setCloudModalStatus('Please enter your access code.', 'error');
                return false;
            }
            if (!navigator.onLine) {
                setCloudModalStatus('You are offline. Reconnect to upload a cloud backup.', 'error');
                return false;
            }

            // Flush the latest edits before creating the cloud snapshot.
            saveState();
            const usernameValue = username.trim();
            const accessCodeValue = accessCode.trim();
            const timestamp = new Date().toISOString();
            const backup = {
                invoiceState: localStorage.getItem('invoiceState') || '{}',
                invoiceHistory: localStorage.getItem('invoiceHistory') || '[]',
            };
            setCloudModalStatus('Uploading to cloud…', 'info');

            try {
                const lookup = new URLSearchParams({
                    select: 'username,access_code',
                    username: `eq.${usernameValue}`,
                    limit: '1',
                });
                const records = await supabaseRequest(`invoice_backups?${lookup.toString()}`);
                const existing = Array.isArray(records) ? records[0] : null;

                if (existing && existing.access_code !== accessCodeValue) {
                    setCloudModalStatus('Access code does not match this username.', 'error');
                    return false;
                }

                const values = {
                    username: usernameValue,
                    access_code: accessCodeValue,
                    data: backup,
                    updated_at: timestamp,
                };
                if (existing) {
                    const updateQuery = new URLSearchParams({
                        username: `eq.${usernameValue}`,
                        select: 'username',
                    });
                    const updated = await supabaseRequest(`invoice_backups?${updateQuery.toString()}`, {
                        method: 'PATCH',
                        body: { data: backup, updated_at: timestamp },
                        headers: { Prefer: 'return=representation' },
                    });
                    if (!Array.isArray(updated) || updated.length === 0) {
                        throw new Error('No backup was updated. Check the table permissions.');
                    }
                    setCloudModalStatus('Cloud backup updated successfully!', 'success');
                    showToast('Cloud backup updated ✓', 'success');
                } else {
                    await supabaseRequest('invoice_backups', {
                        method: 'POST',
                        body: values,
                        headers: { Prefer: 'return=representation' },
                    });
                    setCloudModalStatus('Cloud backup uploaded successfully!', 'success');
                    showToast('Cloud backup uploaded ✓', 'success');
                }
                return true;
            } catch (error) {
                console.error('Cloud upload error:', error);
                setCloudModalStatus(cloudErrorText(error, 'Upload'), 'error');
                return false;
            }
        }

        // ─── cloud load ───────────────────────────────────────

        async function cloudLoad(username) {
            if (!supabaseReady) {
                setCloudModalStatus('Supabase is not configured for this app.', 'error');
                return false;
            }
            if (!username.trim()) {
                setCloudModalStatus('Please enter a username.', 'error');
                return false;
            }
            if (!navigator.onLine) {
                setCloudModalStatus('You are offline. Reconnect to load a cloud backup.', 'error');
                return false;
            }

            setCloudModalStatus('Loading from cloud…', 'info');
            try {
                const query = new URLSearchParams({
                    select: 'data,updated_at',
                    username: `eq.${username.trim()}`,
                    order: 'updated_at.desc',
                    limit: '1',
                });
                const records = await supabaseRequest(`invoice_backups?${query.toString()}`);
                const record = Array.isArray(records) ? records[0] : null;
                if (!record) {
                    setCloudModalStatus(`No backup found for username "${username.trim()}".`, 'error');
                    return false;
                }

                const backup = record.data || {};
                if (backup.invoiceState) localStorage.setItem('invoiceState', backup.invoiceState);
                if (backup.invoiceHistory) localStorage.setItem('invoiceHistory', backup.invoiceHistory);

                const date = record.updated_at ? new Date(record.updated_at).toLocaleString() : 'unknown date';
                setCloudModalStatus(`Backup loaded successfully (updated ${date}).`, 'success');
                showToast('Cloud backup loaded ✓ Reloading…', 'success');
                setTimeout(() => location.reload(), 1200);
                return true;
            } catch (error) {
                console.error('Cloud load error:', error);
                setCloudModalStatus(cloudErrorText(error, 'Load'), 'error');
                return false;
            }
        }

        // ─── cloud modal event handlers ──────────────────────

        function setupCloudModal() {
            const modal = $('cloudModal');
            const cancelBtn = $('cloudModalCancelBtn');
            const actionBtn = $('cloudModalActionBtn');
            const usernameInput = $('cloudUsernameInput');
            const accessInput = $('cloudAccessCodeInput');

            // Close on overlay click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeCloudModal();
            });

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && modal.classList.contains('active')) {
                    closeCloudModal();
                }
            });

            cancelBtn.addEventListener('click', closeCloudModal);

            actionBtn.addEventListener('click', async () => {
                const username = usernameInput.value;
                const accessCode = accessInput.value;

                // Disable button during action
                actionBtn.disabled = true;
                const originalHtml = actionBtn.innerHTML;

                try {
                    if (cloudModalMode === 'upload') {
                        await cloudUpload(username, accessCode);
                    } else {
                        await cloudLoad(username);
                    }
                } finally {
                    actionBtn.disabled = false;
                    actionBtn.innerHTML = originalHtml;
                }
            });

            // Enter key in inputs triggers action
            usernameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    if (cloudModalMode === 'load') {
                        actionBtn.click();
                    } else {
                        accessInput.focus();
                    }
                }
            });

            accessInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    actionBtn.click();
                }
            });

            // Open upload
            $('cloudUploadBtn').addEventListener('click', () => {
                if (!supabaseReady) {
                    showToast('⚠️ Supabase not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY.', 'error', 5000);
                    return;
                }
                openCloudModal('upload');
            });

            // Open load
            $('cloudLoadBtn').addEventListener('click', () => {
                if (!supabaseReady) {
                    showToast('⚠️ Supabase not configured. Please set SUPABASE_URL and SUPABASE_ANON_KEY.', 'error', 5000);
                    return;
                }
                openCloudModal('load');
            });
        }

        // ─── attach input listeners ──────────────────────────

        function attachInputListeners() {
            const fields = [
                invoiceNameInput,
                companyName, companyAddress, companyEmail, companyPhone,
                clientName, clientAddress, clientEmail, clientPhone,
                invNumber, invDate, invDueDate, notes,
            ];
            fields.forEach(field => {
                field.addEventListener('input', () => {
                    renderPreview();
                    if (field === notes) updateSummary();
                    debounceSave();
                });
                field.addEventListener('change', () => {
                    renderPreview();
                    debounceSave();
                });
            });

            taxRate.addEventListener('input', () => {
                updateSummary();
                renderPreview();
                debounceSave();
            });
            discountRate.addEventListener('input', () => {
                updateSummary();
                renderPreview();
                debounceSave();
            });
            amountPaid.addEventListener('input', () => {
                updateSummary();
                renderPreview();
                debounceSave();
            });

            balanceBoxColorInput.addEventListener('input', () => {
                state.balanceBoxColor = balanceBoxColorInput.value;
                renderPreview();
                debounceSave();
            });

            addItemBtn.addEventListener('click', () => {
                addItem('', 1, 0);
            });

            logoUpload.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleLogoUpload(file);
                logoUpload.value = '';
            });

            removeLogoBtn.addEventListener('click', removeLogo);

            logoAspect.addEventListener('change', () => {
                state.logoAspect = logoAspect.value;
                renderPreview();
                debounceSave();
            });

            logoScale.addEventListener('input', () => {
                const val = parseInt(logoScale.value, 10);
                logoScaleLabel.textContent = val + '%';
                state.logoScale = val;
                renderPreview();
                debounceSave();
            });

            invDate.addEventListener('change', () => { renderPreview();
                debounceSave(); });
            invDueDate.addEventListener('change', () => { renderPreview();
                debounceSave(); });

            $('plusBtn').addEventListener('click', handlePlus);

            // ── PAID toggle buttons ──
            document.querySelectorAll('.btn-paid-toggle').forEach(btn => {
                btn.addEventListener('click', togglePaid);
            });

            $('downloadBackupBtn').addEventListener('click', downloadBackup);
            $('restoreBackupInput').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) restoreBackup(file);
                e.target.value = '';
            });
        }

        let deferredInstallPrompt = null;

        function updateCloudConnectivity() {
            if (!supabaseReady) {
                updateCloudStatusBadge(false, 'Not configured');
            } else if (navigator.onLine) {
                updateCloudStatusBadge(true, 'Ready to sync');
            } else {
                updateCloudStatusBadge(false, 'Offline — local mode');
            }
        }

        function setupPwa() {
            const installButton = $('installAppBtn');

            window.addEventListener('beforeinstallprompt', (event) => {
                event.preventDefault();
                deferredInstallPrompt = event;
                installButton.hidden = false;
            });

            installButton.addEventListener('click', async () => {
                if (!deferredInstallPrompt) return;
                const promptEvent = deferredInstallPrompt;
                deferredInstallPrompt = null;
                installButton.hidden = true;
                try {
                    await promptEvent.prompt();
                    const choice = await promptEvent.userChoice;
                    if (choice.outcome === 'accepted') showToast('Ecko Invoice installed ✓', 'success');
                } catch (error) {
                    console.warn('Install prompt was not available:', error);
                }
            });

            window.addEventListener('appinstalled', () => {
                deferredInstallPrompt = null;
                installButton.hidden = true;
                showToast('Ecko Invoice is ready on your device ✓', 'success');
            });

            updateCloudConnectivity();
            window.addEventListener('online', updateCloudConnectivity);
            window.addEventListener('offline', updateCloudConnectivity);

            if ('serviceWorker' in navigator && location.protocol !== 'file:') {
                navigator.serviceWorker.register('./sw.js', { scope: './' })
                    .catch((error) => console.warn('Offline support could not be enabled:', error));
            }
        }

        // ─── init ─────────────────────────────────────────────

        function init() {
            const today = new Date().toISOString().split('T')[0];
            if (!invDate.value) invDate.value = today;
            const due = new Date();
            due.setDate(due.getDate() + 30);
            if (!invDueDate.value) invDueDate.value = due.toISOString().split('T')[0];

            const loaded = loadState();

            if (!loaded) {
                addItem('Web design service', 1, 450);
                addItem('Consultation', 2, 120);
                companyName.value = 'Studio Nine';
                debounceSave();
            }

            attachInputListeners();
            setupTabs();
            setupDownload();
            setupCloudModal();
            setupPwa();
            updatePaidButton();
            renderHistory();
            renderPreview();

            setTimeout(() => {
                saveIndicator.classList.remove('visible');
            }, 1000);
        }

        // ─── expose globals ───────────────────────────────────

        window.loadFromHistory = loadFromHistory;
        window.duplicateHistory = duplicateHistory;
        window.deleteHistory = deleteHistory;
        window.clearAllHistory = clearAllHistory;
        window.switchTab = switchTab;
        window.startRename = startRename;
        window.renameHistory = renameHistory;
        window.resetInvoice = resetInvoice;
        window.togglePaid = togglePaid;

        document.addEventListener('DOMContentLoaded', init);
