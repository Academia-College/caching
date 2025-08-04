// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const redis = require('redis');

async function main() {
    const app = express();
    app.use(express.json());

    // Initialize SQLite DB in file
    const db = new sqlite3.Database('database.sqlite');

    // Create users table and insert sample data
    db.serialize(() => {
        db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
        db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com']);
        db.run('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com']);
    })
    // Initialize Redis client
    const redisClient = redis.createClient();

    redisClient.on('error', (err) => console.error('Redis Client Error', err));
    await redisClient.connect();

    // Helper function to get user from SQLite
    function getUserFromDB(id) {
        return new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // GET user with Redis caching
    app.get('/users/:id', async (req, res) => {
        const id = req.params.id;
        const cacheKey = `user:${id}`;

        try {
            // Check cache first
            const cachedUser = await redisClient.get(cacheKey);
            if (cachedUser) {
                console.log('Cache hit for user', id);
                return res.json(JSON.parse(cachedUser));
            }

            // Cache miss: fetch from DB
            console.log('Cache miss for user', id);
            const user = await getUserFromDB(id);
            if (!user) return res.status(404).json({ error: 'User not found' });

            // Store result in Redis with TTL 60 seconds
            await redisClient.set(cacheKey, JSON.stringify(user), { EX: 60 });

            res.json(user);
        } catch (err) {
            console.error('Error:', err);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // PUT update user and invalidate cache
    app.put('/users/:id', (req, res) => {
        const id = req.params.id;
        const { name, email } = req.body;
        const cacheKey = `user:${id}`;

        db.run('UPDATE users SET name = ?, email = ? WHERE id = ?', [name, email, id], async function (err) {
            if (err) {
                console.error('DB error:', err);
                return res.status(500).json({ error: 'DB error' });
            }
            if (this.changes === 0) return res.status(404).json({ error: 'User not found' });

            // Invalidate cache
            try {
                await redisClient.del(cacheKey);
                console.log('Cache invalidated for user', id);
            } catch (e) {
                console.error('Redis error:', e);
            }

            res.json({ id: Number(id), name, email });
        });
    });

    const PORT = 4000;
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}

main().catch(console.error);
