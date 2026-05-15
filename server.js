// server.js – Steps Premium Suite API
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection pool
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ============================================================
// AUTO DATABASE SETUP - Runs on startup
// ============================================================
async function setupDatabase() {
  console.log('🔄 Checking database setup...');
  
  if (!process.env.DATABASE_URL) {
    console.log('⚠️ DATABASE_URL not set. Skipping auto-migration.');
    return;
  }
  
  try {
    // Check if users table exists
    const checkTable = await dbPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `);
    
    if (!checkTable.rows[0].exists) {
      console.log('📦 Creating database tables...');
      const schemaPath = path.join(__dirname, 'db', 'schema.sql');
      
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await dbPool.query(schema);
        console.log('✅ Database tables created successfully!');
      } else {
        console.log('⚠️ schema.sql not found at:', schemaPath);
      }
    } else {
      console.log('✅ Database tables already exist.');
    }
  } catch (err) {
    console.log('⚠️ Database setup error:', err.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// CLEAN URLS - Access pages without .html extension
// ============================================================
const pages = [
  'dashboard', 'dashboard1', 'reservations', 'apartments',
  'apartments-list', 'apartments-list1', 'housekeeping', 'housekeeping-status', 'reports',
  'store-main', 'store-main1', 'store-outlets', 'store-outlets1', 'outlet-store', 'outlet-store1',
  'store-housekeeping', 'store-kitchen', 'store-public', 'users', 'users1', 'login',
  'activity-logs', 'register', 'back-office', 'index2', 'purchase-orders', 'goods-receipt',
  'purchase-orders-reports', 'goods-receipt-reports', 'store-inventory-reports',
  'point-of-sale', 'sales-report', 'add-reservation'
];

pages.forEach(page => {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pages', `${page}.html`));
  });
});

app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await dbPool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  APARTMENTS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/apartments', async (req, res) => {
  try {
    const { rows } = await dbPool.query(`
      SELECT
        a.*,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM reservations r
            WHERE r.apt_id = a.id
              AND r.checkin <= CURRENT_DATE
              AND r.checkout > CURRENT_DATE
          ) THEN TRUE ELSE FALSE
        END AS occupied
      FROM apartments a
      ORDER BY a.id
    `);
    res.json(rows.map(camelApt));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/apartments/:id', async (req, res) => {
  try {
    const { rows } = await dbPool.query('SELECT * FROM apartments WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment not found' });
    res.json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/apartments/:id', async (req, res) => {
  const { name, type, maxAdults, emoji, color, ratePerNight } = req.body;
  try {
    const { rows } = await dbPool.query(`
      UPDATE apartments
        SET name = COALESCE($1, name),
            type = COALESCE($2, type),
            max_adults = COALESCE($3, max_adults),
            emoji = COALESCE($4, emoji),
            color = COALESCE($5, color),
            rate_per_night = COALESCE($6, rate_per_night)
      WHERE id = $7
      RETURNING *
    `, [name, type, maxAdults, emoji, color, ratePerNight, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Apartment not found' });
    res.json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/apartments', async (req, res) => {
  const { name, type, maxAdults, emoji, color, ratePerNight } = req.body;
  if (!name || !type || !maxAdults || !ratePerNight) {
    return res.status(400).json({ error: 'Name, type, maxAdults, ratePerNight are required' });
  }
  try {
    const { rows } = await dbPool.query(
      `INSERT INTO apartments (name, type, max_adults, emoji, color, rate_per_night)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [name, type, maxAdults, emoji || '', color || '#2d9c6e', ratePerNight]
    );
    res.status(201).json(camelApt(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/apartments/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount: resCount } = await dbPool.query('SELECT id FROM reservations WHERE apt_id = $1 LIMIT 1', [id]);
    if (resCount > 0) {
      return res.status(400).json({ error: 'Cannot delete apartment with existing reservations. Remove reservations first.' });
    }
    const { rowCount } = await dbPool.query('DELETE FROM apartments WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Apartment not found' });
    res.json({ message: 'Apartment deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  RESERVATIONS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/reservations', async (req, res) => {
  const { aptId, from, to } = req.query;
  const conditions = [];
  const values = [];

  if (aptId) { values.push(aptId); conditions.push(`r.apt_id = $${values.length}`); }
  if (from) { values.push(from); conditions.push(`r.checkout + COALESCE(r.checkout_time, '11:00:00') > $${values.length}::timestamp`); }
  if (to) { values.push(to); conditions.push(`r.checkin <= $${values.length}::date`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await dbPool.query(`
      SELECT 
        r.*, 
        a.name AS apt_name, 
        a.type AS apt_type, 
        a.emoji AS apt_emoji, 
        a.color AS apt_color,
        TO_CHAR(r.checkin, 'YYYY-MM-DD') as checkin_str,
        TO_CHAR(r.checkout, 'YYYY-MM-DD') as checkout_str,
        TO_CHAR(r.checkout_time, 'HH24:MI:SS') as checkout_time_str,
        CASE 
          WHEN (r.checkout + COALESCE(r.checkout_time, '11:00:00')) <= CURRENT_TIMESTAMP THEN 'checked_out'
          WHEN r.checkin <= CURRENT_DATE THEN 'active'
          ELSE 'upcoming'
        END as current_status
      FROM reservations r
      JOIN apartments a ON a.id = r.apt_id
      ${where}
      ORDER BY r.checkin DESC
    `, values);
    
    const formattedRows = rows.map(row => ({
      ...row,
      checkin: row.checkin_str,
      checkout: row.checkout_str,
      checkoutTime: row.checkout_time_str || '11:00:00',
      currentStatus: row.current_status
    }));
    
    res.json(formattedRows.map(camelRes));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/:id', async (req, res) => {
  try {
    const { rows } = await dbPool.query(`
      SELECT 
        r.*, 
        a.name AS apt_name, 
        a.type AS apt_type, 
        a.emoji AS apt_emoji, 
        a.color AS apt_color,
        TO_CHAR(r.checkin, 'YYYY-MM-DD') as checkin_str,
        TO_CHAR(r.checkout, 'YYYY-MM-DD') as checkout_str
      FROM reservations r
      JOIN apartments a ON a.id = r.apt_id
      WHERE r.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    
    const row = rows[0];
    const formattedRow = {
      ...row,
      checkin: row.checkin_str,
      checkout: row.checkout_str
    };
    
    res.json(camelRes(formattedRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reservations', async (req, res) => {
  let { aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, checkoutTime, userId, username } = req.body;

  if (checkin) checkin = String(checkin).split('T')[0];
  if (checkout) checkout = String(checkout).split('T')[0];
  const finalCheckoutTime = checkoutTime || '11:00:00';

  if (!aptId || !guest || !email || !checkin || !checkout) {
    return res.status(400).json({ error: 'aptId, guest, email, checkin, checkout are required' });
  }
  if (checkin >= checkout) {
    return res.status(400).json({ error: 'checkout must be after checkin' });
  }

  try {
    const conflict = await dbPool.query(`
      SELECT id FROM reservations
      WHERE apt_id = $1
        AND checkin < $3::date
        AND (checkout + COALESCE(checkout_time, '11:00:00')) > ($2::date + $4::time)
    `, [aptId, checkin, checkout, finalCheckoutTime]);

    if (conflict.rows.length) {
      return res.status(409).json({ error: 'Apartment is already booked for those dates' });
    }

    const { rows } = await dbPool.query(`
      INSERT INTO reservations (apt_id, guest, email, mobile, country, city, checkin, checkout, checkout_time, adults, children, rate_type, total)
      VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::time,$10,$11,$12,$13)
      RETURNING *
    `, [aptId, guest, email, mobile || null, country || null, city || null,
        checkin, checkout, finalCheckoutTime, adults || 1, children || 0, rateType || 'Full', total || 0]);

    const result = camelRes(rows[0]);
    res.status(201).json(result);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/reservations/:id', async (req, res) => {
  let { aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total } = req.body;
  
  if (checkin) checkin = String(checkin).split('T')[0];
  if (checkout) checkout = String(checkout).split('T')[0];

  try {
    if (aptId && checkin && checkout) {
      const conflict = await dbPool.query(`
        SELECT id FROM reservations
        WHERE apt_id = $1
          AND id != $4
          AND checkin < $3::date
          AND checkout > $2::date
      `, [aptId, checkin, checkout, req.params.id]);

      if (conflict.rows.length) {
        return res.status(409).json({ error: 'Apartment is already booked for those dates' });
      }
    }

    const { rows } = await dbPool.query(`
      UPDATE reservations SET
        apt_id = COALESCE($1, apt_id),
        guest = COALESCE($2, guest),
        email = COALESCE($3, email),
        mobile = COALESCE($4, mobile),
        country = COALESCE($5, country),
        city = COALESCE($6, city),
        checkin = COALESCE($7::date, checkin),
        checkout = COALESCE($8::date, checkout),
        adults = COALESCE($9, adults),
        children = COALESCE($10, children),
        rate_type = COALESCE($11, rate_type),
        total = COALESCE($12, total)
      WHERE id = $13
      RETURNING *
    `, [aptId, guest, email, mobile, country, city, checkin, checkout, adults, children, rateType, total, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    res.json(camelRes(rows[0]));
  } catch (err) {
    console.error('Error updating reservation:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', async (req, res) => {
  try {
    const { rowCount } = await dbPool.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Reservation not found' });
    res.json({ message: 'Reservation deleted' });
  } catch (err) {
    console.error('Error deleting reservation:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  REPORTS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/reports/summary', async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const values = [];
  if (from) { values.push(from); conditions.push(`r.checkout > $${values.length}`); }
  if (to) { values.push(to); conditions.push(`r.checkin <= $${values.length}`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows: summary } = await dbPool.query(`
      SELECT
        COUNT(*)::int AS total_reservations,
        COALESCE(SUM(total), 0)::int AS total_revenue,
        COALESCE(AVG(checkout - checkin), 0)::numeric(6,2) AS avg_stay_nights,
        COALESCE(SUM(checkout - checkin), 0)::int AS total_nights
      FROM reservations r
      ${where}
    `, values);

    const { rows: byApt } = await dbPool.query(`
      SELECT
        a.id, a.name, a.type, a.color, a.emoji, a.rate_per_night,
        COUNT(r.id)::int AS bookings,
        COALESCE(SUM(r.checkout - r.checkin), 0)::int AS nights,
        COALESCE(SUM(r.total), 0)::int AS revenue
      FROM apartments a
      LEFT JOIN reservations r ON r.apt_id = a.id
        ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}
      GROUP BY a.id
      ORDER BY a.id
    `, values);

    res.json({
      summary: {
        totalReservations: summary[0].total_reservations,
        totalRevenue: summary[0].total_revenue,
        avgStayNights: parseFloat(summary[0].avg_stay_nights),
        totalNights: summary[0].total_nights,
      },
      byApartment: byApt.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        color: r.color,
        emoji: r.emoji,
        ratePerNight: r.rate_per_night,
        bookings: r.bookings,
        nights: r.nights,
        revenue: r.revenue,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════════

function camelApt(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    maxAdults: r.max_adults,
    emoji: r.emoji,
    color: r.color,
    ratePerNight: r.rate_per_night,
    occupied: r.occupied ?? undefined,
  };
}

function camelRes(r) {
  return {
    id: r.id,
    aptId: r.apt_id,
    guest: r.guest,
    email: r.email,
    mobile: r.mobile,
    country: r.country,
    city: r.city,
    checkin: r.checkin,
    checkout: r.checkout,
    adults: r.adults,
    children: r.children,
    rateType: r.rate_type,
    total: r.total,
    createdAt: r.created_at,
    aptName: r.apt_name ?? undefined,
    aptType: r.apt_type ?? undefined,
    aptEmoji: r.apt_emoji ?? undefined,
    aptColor: r.apt_color ?? undefined,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  AUTHENTICATION API
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/register', async (req, res) => {
  const { fullName, email, password, role } = req.body;
  
  console.log('Registration attempt:', { fullName, email, role });
  
  if (!fullName || !email || !password || !role) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const existing = await dbPool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const username = email.split('@')[0];
    
    const result = await dbPool.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, username, email, role, full_name`,
      [username, email, hashedPassword, role, fullName]
    );
    
    res.status(201).json({
      message: 'User registered successfully',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  try {
    const { rows } = await dbPool.query(
      'SELECT id, username, email, password_hash, role, full_name FROM users WHERE email = $1',
      [email]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;
  if (!userId || !oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const { rows } = await dbPool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const newHash = await bcrypt.hash(newPassword, 10);
    await dbPool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  USERS API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await dbPool.query(
      'SELECT id, username, email, role, full_name, created_at, updated_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { rows } = await dbPool.query(
      'SELECT id, username, email, role, full_name, created_at, updated_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  const { username, email, password, role, full_name } = req.body;
  
  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'Username, email, password and role are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const existing = await dbPool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const existingUsername = await dbPool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUsername.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await dbPool.query(
      `INSERT INTO users (username, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, role, full_name, created_at, updated_at`,
      [username, email, hashedPassword, role, full_name || null]
    );
    
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user: ' + err.message });
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  const { username, email, role, full_name, password } = req.body;
  
  try {
    const existing = await dbPool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    let updateFields = [];
    let values = [];
    let paramCount = 1;
    
    if (username) {
      updateFields.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (email) {
      updateFields.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (role) {
      updateFields.push(`role = $${paramCount++}`);
      values.push(role);
    }
    if (full_name !== undefined) {
      updateFields.push(`full_name = $${paramCount++}`);
      values.push(full_name);
    }
    if (password && password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push(`password_hash = $${paramCount++}`);
      values.push(hashedPassword);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(id);
    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING id, username, email, role, full_name, created_at, updated_at`;
    const { rows } = await dbPool.query(query, values);
    
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user: ' + err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const adminCount = await dbPool.query('SELECT COUNT(*) FROM users WHERE role = $1', ['admin']);
    const userCheck = await dbPool.query('SELECT role FROM users WHERE id = $1', [id]);
    
    if (userCheck.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (userCheck.rows[0].role === 'admin' && parseInt(adminCount.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }
    
    const { rowCount } = await dbPool.query('DELETE FROM users WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  VENDORS API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/vendors', async (req, res) => {
  try {
    const { rows } = await dbPool.query('SELECT * FROM vendors ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vendors', async (req, res) => {
  const { name, type } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Vendor name required' });
  }
  try {
    const { rows } = await dbPool.query(
      'INSERT INTO vendors (name, type) VALUES ($1, $2) RETURNING *',
      [name, type || 'local']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Vendor already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  OUTLETS API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/outlets', async (req, res) => {
  try {
    const { rows } = await dbPool.query('SELECT * FROM outlets ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/outlets', async (req, res) => {
  const { name } = req.body;
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) {
    return res.status(400).json({ error: 'Invalid outlet name. Use lowercase letters, numbers, underscores.' });
  }
  try {
    const { rows } = await dbPool.query('INSERT INTO outlets (name) VALUES ($1) RETURNING *', [name]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Outlet already exists' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/outlets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await dbPool.query('DELETE FROM outlets WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Outlet not found' });
    res.json({ message: 'Outlet deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  STORE ITEMS API
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/store/items', async (req, res) => {
  try {
    const { rows } = await dbPool.query('SELECT * FROM store_items ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/store/items', async (req, res) => {
  const { name, category, cost, quantity, unit } = req.body;
  if (!name || !category || !cost || !quantity) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const parts = quantity.trim().split(' ');
  const stock_value = parseFloat(parts[0]);
  const itemUnit = unit || parts[1] || 'units';
  try {
    const { rows } = await dbPool.query(
      `INSERT INTO store_items (name, category, cost, quantity, stock_value, unit)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, category, cost, quantity, stock_value, itemUnit]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/store/items/:id', async (req, res) => {
  const { name, category, cost, quantity, unit } = req.body;
  const id = req.params.id;
  const parts = quantity.trim().split(' ');
  const stock_value = parseFloat(parts[0]);
  const itemUnit = unit || parts[1] || 'units';
  try {
    const { rows } = await dbPool.query(
      `UPDATE store_items SET name=$1, category=$2, cost=$3, quantity=$4, stock_value=$5, unit=$6
       WHERE id=$7 RETURNING *`,
      [name, category, cost, quantity, stock_value, itemUnit, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/store/items/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await dbPool.query('DELETE FROM store_items WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Item not found' });
    res.json({ message: 'Item deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════════════════════════════════════

// Run database setup, then start server
setupDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Steps PMS API running on http://localhost:${PORT}`);
    console.log(`📄 Clean URLs enabled - access pages without .html`);
    console.log(`   Example: http://localhost:${PORT}/dashboard`);
  });
});