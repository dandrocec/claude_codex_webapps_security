'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');

const initSchema = require('./db/schema');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const { requireLogin } = require('./middleware/auth');

// Ensure the schema exists before serving traffic.
initSchema();

const app = express();
const PORT = process.env.PORT || 5080;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'warehouse-dev-secret',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(flash());

// Expose the current user and flash messages to every view.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

app.get('/', requireLogin, (req, res) => {
  res.render('dashboard', { title: 'Dashboard' });
});

app.use('/', authRoutes);
app.use('/products', productRoutes);
app.use('/orders', orderRoutes);

// 404 handler.
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'The page you requested does not exist.',
  });
});

// Central error handler.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'Server error',
    message: 'Something went wrong. Please try again.',
  });
});

app.listen(PORT, () => {
  console.log(`Warehouse app running at http://localhost:${PORT}`);
});
