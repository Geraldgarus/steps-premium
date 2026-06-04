// Reservations table specific functions
async function loadAndRenderReservations() {
  setLoading('res-table-body', true);
  try {
    [APARTMENTS, reservations] = await Promise.all([
      apiGet('/apartments'),
      apiGet('/reservations'),
    ]);
    renderReservationsTable();
    updateReservationStats();
  } catch (err) {
    showToast('Failed to load reservations: ' + err.message, '❌');
  }
}

function getPaymentBadge(paymentStatus, balance) {
  if (paymentStatus === 'paid') {
    return '<span class="payment-badge-paid" style="background:#d1fae5; color:#065f46; padding:4px 8px; border-radius:20px; font-size:11px; font-weight:600; display:inline-block;">✅ Paid</span>';
  } else if (paymentStatus === 'partial') {
    return `<span class="payment-badge-partial" style="background:#fef3c7; color:#d97706; padding:4px 8px; border-radius:20px; font-size:11px; font-weight:600; display:inline-block;">🟡 Partial<br><small style="font-size:9px;">Due: ${fmtTSH(balance)}</small></span>`;
  } else {
    return '<span class="payment-badge-unpaid" style="background:#fee2e2; color:#dc2626; padding:4px 8px; border-radius:20px; font-size:11px; font-weight:600; display:inline-block;">❌ Unpaid</span>';
  }
}

function renderReservationsTable() {
  const tbody = document.getElementById('res-table-body');
  const now = new Date();
  
  if (!reservations || !reservations.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📋</div><p>No reservations yet</p></div></td></tr>`;
    return;
  }
  
  let html = '';
  
  for (const res of reservations) {
    const apt = getApt(res.aptId);
    const aptName = apt?.name || res.aptName || '—';
    const nights = daysBetween(res.checkin, res.checkout);
    
    // Calculate status with 11:00 AM checkout time
    const rCheckin = new Date(res.checkin);
    const rCheckout = new Date(res.checkout);
    rCheckout.setHours(11, 0, 0, 0);
    
    let status = '';
    let chipClass = '';
    
    if (rCheckout <= now) {
      status = 'Checked Out';
      chipClass = 'chip-gray';
    } else if (rCheckin <= now) {
      status = 'Active';
      chipClass = 'chip-green';
    } else {
      status = 'Upcoming';
      chipClass = 'chip-blue';
    }
    
    // Get payment badge
    const paymentBadge = getPaymentBadge(res.paymentStatus, res.balance);
    
    html += `<tr>
      <td>
        <div class="guest-cell">
          <span class="guest-name">${escapeHtml(res.guest)}</span>
          <span class="guest-email">${escapeHtml(res.email)}</span>
        </div>
      </td>
      <td>${escapeHtml(aptName)}</td>
      <td>${fmtDate(res.checkin)}</td>
      <td>${fmtDate(res.checkout)} at 11:00 AM</td>
      <td>${nights}n</td>
      <td>${res.adults}A ${res.children}C</td>
      <td class="total-cell">${fmtTSH(res.total)}</td>
      <td>${paymentBadge}</td>
      <td><span class="chip ${chipClass}">${status}</span></td>
      <td><button class="btn btn-outline" style="padding:6px 12px; font-size:12px;" onclick="openDetail(${res.id})">View</button></td>
    </tr>`;
  }
  
  tbody.innerHTML = html;
}

function updateReservationStats() {
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkoutTimeToday = new Date(today);
  checkoutTimeToday.setHours(11, 0, 0, 0);
  
  // Active: checkin <= now AND checkout+time > now (11:00 AM checkout)
  const active = reservations.filter(r => {
    const rCheckin = new Date(r.checkin);
    const rCheckout = new Date(r.checkout);
    rCheckout.setHours(11, 0, 0, 0);
    return rCheckin <= now && rCheckout > now;
  }).length;
  
  // Upcoming: checkin > today (future)
  const upcoming = reservations.filter(r => {
    const rCheckin = new Date(r.checkin);
    rCheckin.setHours(0, 0, 0, 0);
    return rCheckin > today;
  }).length;
  
  // Checkouts today: checkout date is today AND current time is BEFORE 11:00 AM
  const checkoutToday = reservations.filter(r => {
    const rCheckout = new Date(r.checkout);
    const isToday = rCheckout.toDateString() === today.toDateString();
    return isToday && now < checkoutTimeToday;
  }).length;
  
  const activeCountElem = document.getElementById('stat-active-count');
  const upcomingCountElem = document.getElementById('stat-upcoming-count');
  const checkoutTodayCountElem = document.getElementById('stat-checkout-today-count');
  
  if (activeCountElem) activeCountElem.textContent = active;
  if (upcomingCountElem) upcomingCountElem.textContent = upcoming;
  if (checkoutTodayCountElem) checkoutTodayCountElem.textContent = checkoutToday;
  
  console.log(`📊 Stats: Active=${active}, Upcoming=${upcoming}, Checkouts Today=${checkoutToday}, Time=${now.toLocaleTimeString()}`);
}

async function openDetail(resId) {
  try {
    const res = await apiGet(`/reservations/${resId}`);
    selectedReservation = res;
    const apt = getApt(res.aptId) || { name: res.aptName || '—' };
    const nights = daysBetween(res.checkin, res.checkout);
    
    // Calculate if active with 11:00 AM checkout
    const now = new Date();
    const rCheckout = new Date(res.checkout);
    rCheckout.setHours(11, 0, 0, 0);
    const isActive = rCheckout > now;
    
    // Get payment status badge
    let paymentBadge = '';
    if (res.paymentStatus === 'paid') {
      paymentBadge = '<span style="background:#d1fae5; color:#065f46; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600;">✅ Paid in Full</span>';
    } else if (res.paymentStatus === 'partial') {
      paymentBadge = `<span style="background:#fef3c7; color:#d97706; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600;">🟡 Partial Payment<br><small>Due: ${fmtTSH(res.balance || 0)}</small></span>`;
    } else {
      paymentBadge = '<span style="background:#fee2e2; color:#dc2626; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:600;">❌ Unpaid</span>';
    }

    document.getElementById('detail-body').innerHTML = [
      { icon: '👤', label: 'Guest Name', value: escapeHtml(res.guest) },
      { icon: '📧', label: 'Email', value: escapeHtml(res.email) },
      { icon: '📱', label: 'Mobile', value: escapeHtml(res.mobile || '—') },
      { icon: '🪪', label: 'ID Type', value: escapeHtml(res.idType || '—') },
      { icon: '📋', label: 'ID Number', value: escapeHtml(res.identification || '—') },
      { icon: '🌍', label: 'Country', value: escapeHtml(res.country || '—') },
      { icon: '🏙️', label: 'City', value: escapeHtml(res.city || '—') },
      { icon: '🏠', label: 'Apartment', value: escapeHtml(apt.name) },
      { icon: '💳', label: 'Rate Type', value: escapeHtml(res.rateType) },
      { icon: '📅', label: 'Check-in', value: fmtDate(res.checkin) },
      { icon: '📅', label: 'Check-out', value: fmtDate(res.checkout) + ' at 11:00 AM' },
      { icon: '🌙', label: 'Nights', value: nights + ' night' + (nights !== 1 ? 's' : '') },
      { icon: '👨‍👩‍👧', label: 'Adults / Children', value: `${res.adults} Adults, ${res.children} Children` },
    ].map(r => `<div class="detail-row"><div class="detail-icon">${r.icon}</div><div><div class="detail-label">${r.label}</div><div class="detail-value">${r.value}</div></div></div>`).join('') +
    
    // PAYMENT SECTION
    `<div style="margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div class="detail-label" style="font-size: 13px; font-weight: 600;">💰 Payment Status</div>
        <div>${paymentBadge}</div>
      </div>
      <div class="detail-row"><div class="detail-icon">💳</div><div><div class="detail-label">Payment Method</div><div class="detail-value">${escapeHtml(res.paymentMethod || '—')}</div></div></div>
      <div class="detail-row"><div class="detail-icon">💵</div><div><div class="detail-label">Amount Paid</div><div class="detail-value">${fmtTSH(res.amountPaid || 0)}</div></div></div>
      <div class="detail-row"><div class="detail-icon">⚖️</div><div><div class="detail-label">Balance Due</div><div class="detail-value">${fmtTSH(res.balance || 0)}</div></div></div>
    </div>` +
    
    `<div class="detail-total"><span>Total Rate</span><span>${fmtTSH(res.total)}</span></div>` +
    (isActive ? `<div style="margin-top:16px;padding:12px;background:#e8f5e9;border-radius:8px;text-align:center;">🟢 Currently staying - Checkout at 11:00 AM</div>` : 
                 `<div style="margin-top:16px;padding:12px;background:#f5f5f5;border-radius:8px;text-align:center;">✅ Reservation completed</div>`);

    document.getElementById('panel-overlay').classList.add('open');
    document.getElementById('detail-panel').classList.add('open');
  } catch (err) {
    showToast('Could not load reservation: ' + err.message, '❌');
  }
}

function closeDetailPanel() {
  document.getElementById('detail-panel')?.classList.remove('open');
  document.getElementById('panel-overlay')?.classList.remove('open');
  selectedReservation = null;
}

async function deleteSelectedReservation() {
  if (!selectedReservation) return;
  if (!confirm(`Delete reservation for ${selectedReservation.guest}?`)) return;
  try {
    await apiDelete(`/reservations/${selectedReservation.id}`);
    closeDetailPanel();
    loadAndRenderReservations();
    showToast('Reservation deleted', '🗑️');
  } catch (err) {
    showToast('Delete failed: ' + err.message, '❌');
  }
}

// Checkout function for reservations page
async function checkoutReservation() {
  if (!selectedReservation) {
    showToast('No reservation selected', '⚠️');
    return;
  }
  
  const now = new Date();
  const rCheckout = new Date(selectedReservation.checkout);
  rCheckout.setHours(11, 0, 0, 0);
  
  if (rCheckout <= now) {
    showToast('Guest is already checked out (after 11:00 AM)', 'ℹ️');
    closeDetailPanel();
    await loadAndRenderReservations();
    return;
  }
  
  const today = isoDate(now);
  const nightsOriginal = daysBetween(selectedReservation.checkin, selectedReservation.checkout);
  const nightsNew = daysBetween(selectedReservation.checkin, today);
  const pricePerNight = selectedReservation.total / nightsOriginal;
  const newTotal = Math.round(pricePerNight * nightsNew);
  
  if (!confirm(`Checkout ${selectedReservation.guest} today at 11:00 AM?\nOriginal total: ${fmtTSH(selectedReservation.total)}\nNew total: ${fmtTSH(newTotal)}`)) return;
  
  try {
    const payload = { ...selectedReservation, checkout: today, total: newTotal };
    await apiPut(`/reservations/${selectedReservation.id}`, payload);
    showToast(`✅ ${selectedReservation.guest} checked out! New total: ${fmtTSH(newTotal)}`, '🚪');
    closeDetailPanel();
    await loadAndRenderReservations();
  } catch (err) {
    showToast('Checkout failed: ' + err.message, '❌');
  }
}

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    APARTMENTS = await apiGet('/apartments');
  } catch (err) {
    showToast('⚠️ Cannot reach API server', '❌');
  }
  loadAndRenderReservations();
});

window.openDetail = openDetail;
window.closeDetailPanel = closeDetailPanel;
window.deleteSelectedReservation = deleteSelectedReservation;
window.checkoutReservation = checkoutReservation;