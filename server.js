const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const db = new sqlite3.Database('./database.db');

// Uygulama Ayarları
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'nizip_reklam_gizli_anahtar_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 saatlik oturum
}));

// Türkçe Karakterleri URL Dostu (Slug) Formatına Dönüştüren Fonksiyon
function turkceSlug(metin) {
    let str = metin.toString().toLowerCase().trim();
    
    const karakterler = {
        'ş': 's', 'ı': 'i', 'ğ': 'g', 'ç': 'c', 'ö': 'o', 'ü': 'u',
        'Ş': 's', 'İ': 'i', 'Ğ': 'g', 'Ç': 'c', 'Ö': 'o', 'Ü': 'u'
    };

    for (let key in karakterler) {
        str = str.replace(new RegExp(key, 'g'), karakterler[key]);
    }

    return str
        .replace(/[^a-z0-9\s-]/g, '') // Alfanümerik olmayanları kaldır
        .replace(/[\s_]+/g, '-')      // Boşlukları tireye dönüştür
        .replace(/-+/g, '-');         // Art arda gelen tireleri temizle
}

// Veritabanı Kurulumu
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        summary TEXT,
        content TEXT NOT NULL,
        image_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL
    )`, () => {
        // Tablo boşsa varsayılan admin kullanıcısını oluşturur
        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (row && row.count === 0) {
                const hashedPassword = bcrypt.hashSync('admin123', 10);
                db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', hashedPassword]);
                console.log("Varsayılan yönetici hesabı oluşturuldu. Kullanıcı Adı: admin, Şifre: admin123");
            }
        });
    });
});

// Yönetici Giriş Kontrolü (Middleware)
const girisZorunlu = (req, res, next) => {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
};

// --- GENEL (ZİYARETÇİ) ROTALARI ---

// Anasayfa (Hizmetler ve Blog Yazıları)
app.get('/', (req, res) => {
    db.all("SELECT * FROM posts ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.send("Veritabanı hatası oluştu.");
        res.render('index', { posts: rows });
    });
});

// Blog Detay Sayfası
app.get('/post/:slug', (req, res) => {
    db.get("SELECT * FROM posts WHERE slug = ?", [req.params.slug], (err, row) => {
        if (!row) return res.status(404).send("Yazı bulunamadı.");
        res.render('post', { post: row });
    });
});

// --- YÖNETİCİ GİRİŞ / ÇIKIŞ ROTALARI ---

// Giriş Sayfası
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Giriş Yapma İşlemi
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (user && bcrypt.compareSync(password, user.password)) {
            req.session.userId = user.id;
            req.session.username = user.username;
            res.redirect('/admin');
        } else {
            res.render('login', { error: 'Kullanıcı adı veya şifre hatalı.' });
        }
    });
});

// Çıkış Yapma İşlemi
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// --- YÖNETİM PANELİ ROTALARI ---

// Yönetim Paneli Anasayfası
app.get('/admin', girisZorunlu, (req, res) => {
    db.all("SELECT * FROM posts ORDER BY created_at DESC", [], (err, rows) => {
        res.render('admin', { posts: rows, username: req.session.username });
    });
});

// Yeni Yazı Ekleme Sayfası
app.get('/admin/new', girisZorunlu, (req, res) => {
    res.render('admin-create');
});

// Yeni Yazı Kaydetme İşlemi
app.post('/admin/new', girisZorunlu, (req, res) => {
    const { title, summary, content, image_url } = req.body;
    const slug = turkceSlug(title);
    
    db.run("INSERT INTO posts (title, slug, summary, content, image_url) VALUES (?, ?, ?, ?, ?)", 
        [title, slug, summary, content, image_url], 
        (err) => {
            if (err) {
                return res.send("Yazı eklenirken hata oluştu. Bu başlık daha önce kullanılmış olabilir.");
            }
            res.redirect('/admin');
        }
    );
});

// Yazı Düzenleme Sayfası
app.get('/admin/edit/:id', girisZorunlu, (req, res) => {
    db.get("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, row) => {
        if (!row) return res.status(404).send("Yazı bulunamadı.");
        res.render('admin-edit', { post: row });
    });
});

// Yazı Güncelleme İşlemi
app.post('/admin/edit/:id', girisZorunlu, (req, res) => {
    const { title, summary, content, image_url } = req.body;
    const slug = turkceSlug(title);
    
    db.run("UPDATE posts SET title = ?, slug = ?, summary = ?, content = ?, image_url = ? WHERE id = ?",
        [title, slug, summary, content, image_url, req.params.id],
        (err) => {
            if (err) return res.send("Yazı güncellenirken hata oluştu.");
            res.redirect('/admin');
        }
    );
});

// Yazı Silme İşlemi
app.post('/admin/delete/:id', girisZorunlu, (req, res) => {
    db.run("DELETE FROM posts WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.send("Yazı silinirken hata oluştu.");
        res.redirect('/admin');
    });
});

// Sunucuyu Başlat
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Sunucu aktif: http://localhost:${PORT}`);
});
