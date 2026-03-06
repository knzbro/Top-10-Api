import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import shortid from 'shortid';
import validUrl from 'valid-url';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// ========== MongoDB Connection ==========
mongoose.connect('mongodb://localhost:27017/allinone')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.log('❌ MongoDB Error:', err));

// ========== Schemas ==========

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  age: Number,
  createdAt: { type: Date, default: Date.now }
});

// Post Schema
const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  content: { type: String, required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  likes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// URL Schema
const urlSchema = new mongoose.Schema({
  longUrl: { type: String, required: true },
  shortCode: { type: String, required: true, unique: true },
  clicks: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: '30d' }
});

// Todo Schema
const todoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

// Product Schema (E-Commerce)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  category: String,
  stock: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

// ========== Models ==========
const User = mongoose.model('User', userSchema);
const Post = mongoose.model('Post', postSchema);
const Url = mongoose.model('Url', urlSchema);
const Todo = mongoose.model('Todo', todoSchema);
const Product = mongoose.model('Product', productSchema);

// ========== Middleware ==========
interface AuthRequest extends express.Request {
  user?: any;
}

const auth = async (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error();
    
    const decoded = jwt.verify(token, 'secret123');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please authenticate' });
  }
};

// ========== API Routes ==========

// ===== 1. AUTH APIS =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, age } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashedPassword, age });
    await user.save();

    const token = jwt.sign({ id: user._id }, 'secret123');
    res.status(201).json({ user: { id: user._id, name, email }, token });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, 'secret123');
    res.json({ user: { id: user._id, name: user.name, email: user.email }, token });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 2. USER APIS =====
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find().select('-password').limit(10);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users/profile', auth, async (req: AuthRequest, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 3. POST APIS =====
app.post('/api/posts', auth, async (req: AuthRequest, res) => {
  try {
    const post = new Post({
      ...req.body,
      author: req.user.id
    });
    await post.save();
    res.status(201).json(post);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', 'name email')
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/posts/:id/like', async (req, res) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $inc: { likes: 1 } },
      { new: true }
    );
    res.json(post);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 4. URL SHORTENER APIS =====
app.post('/api/url/shorten', async (req, res) => {
  const { longUrl } = req.body;
  const baseUrl = 'http://localhost:5000';

  if (!validUrl.isUri(longUrl)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    let url = await Url.findOne({ longUrl });
    if (url) {
      return res.json({
        longUrl: url.longUrl,
        shortUrl: `${baseUrl}/${url.shortCode}`,
        shortCode: url.shortCode,
        clicks: url.clicks
      });
    }

    const shortCode = shortid.generate();
    url = new Url({ longUrl, shortCode });
    await url.save();

    res.json({
      longUrl: url.longUrl,
      shortUrl: `${baseUrl}/${url.shortCode}`,
      shortCode: url.shortCode,
      clicks: url.clicks
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/:code', async (req, res) => {
  try {
    const url = await Url.findOne({ shortCode: req.params.code });
    if (url) {
      url.clicks++;
      await url.save();
      return res.redirect(url.longUrl);
    }
    res.status(404).json({ error: 'URL not found' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/url/stats/:code', async (req, res) => {
  try {
    const url = await Url.findOne({ shortCode: req.params.code });
    if (!url) return res.status(404).json({ error: 'URL not found' });
    res.json(url);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 5. TODO APIS =====
app.post('/api/todos', auth, async (req: AuthRequest, res) => {
  try {
    const todo = new Todo({
      ...req.body,
      userId: req.user.id
    });
    await todo.save();
    res.status(201).json(todo);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/todos', auth, async (req: AuthRequest, res) => {
  try {
    const todos = await Todo.find({ userId: req.user.id });
    res.json(todos);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/todos/:id', auth, async (req: AuthRequest, res) => {
  try {
    const todo = await Todo.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { completed: req.body.completed },
      { new: true }
    );
    res.json(todo);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/todos/:id', auth, async (req: AuthRequest, res) => {
  try {
    await Todo.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ message: 'Todo deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 6. PRODUCT APIS (E-Commerce) =====
app.post('/api/products', async (req, res) => {
  try {
    const product = new Product(req.body);
    await product.save();
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { category, minPrice, maxPrice } = req.query;
    let query: any = {};
    
    if (category) query.category = category;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    
    const products = await Product.find(query).limit(20);
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 7. SEARCH API =====
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query required' });

    const searchRegex = new RegExp(q as string, 'i');
    
    const [users, posts, products] = await Promise.all([
      User.find({ name: searchRegex }).select('name email').limit(5),
      Post.find({ title: searchRegex }).populate('author', 'name').limit(5),
      Product.find({ 
        $or: [{ name: searchRegex }, { description: searchRegex }] 
      }).limit(5)
    ]);

    res.json({ users, posts, products });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 8. DASHBOARD STATS API =====
app.get('/api/stats', async (req, res) => {
  try {
    const [userCount, postCount, productCount, urlCount] = await Promise.all([
      User.countDocuments(),
      Post.countDocuments(),
      Product.countDocuments(),
      Url.countDocuments()
    ]);

    res.json({
      users: userCount,
      posts: postCount,
      products: productCount,
      urls: urlCount,
      totalClicks: (await Url.aggregate([{ $group: { _id: null, total: { $sum: '$clicks' } } }]))[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== 9. HEALTH CHECK API =====
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// ===== 10. HOME API =====
app.get('/', (req, res) => {
  res.json({
    name: '🚀 All-in-One API',
    version: '1.0.0',
    description: '10 APIs in one file',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login'
      },
      users: {
        all: 'GET /api/users',
        profile: 'GET /api/users/profile (Auth)'
      },
      posts: {
        create: 'POST /api/posts (Auth)',
        all: 'GET /api/posts',
        like: 'POST /api/posts/:id/like'
      },
      url: {
        shorten: 'POST /api/url/shorten',
        stats: 'GET /api/url/stats/:code',
        redirect: 'GET /:code'
      },
      todos: {
        create: 'POST /api/todos (Auth)',
        list: 'GET /api/todos (Auth)',
        update: 'PUT /api/todos/:id (Auth)',
        delete: 'DELETE /api/todos/:id (Auth)'
      },
      products: {
        create: 'POST /api/products',
        list: 'GET /api/products',
        detail: 'GET /api/products/:id'
      },
      search: 'GET /api/search?q=term',
      stats: 'GET /api/stats',
      health: 'GET /api/health'
    }
  });
});

// ========== Start Server ==========
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`
  🚀 Server running on http://localhost:${PORT}
  📁 All APIs in one file
  🔥 Total APIs: 10+
  `);
});