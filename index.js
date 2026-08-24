const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

// MongoDB Connection Setup
const uri = process.env.MONGO_URL;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    const db = client.db('lifecoach');
    const lessonsCollection = db.collection('lessons');
    const usersCollection = db.collection('user');

    console.log("Successfully connected to MongoDB!");

    // Health check route
    app.get('/', (req, res) => {
      res.send('LifeCoach API Server is Running');
    });

    // GET: All lessons
    app.get('/dashboard/lessons', async (req, res) => {
      try {
        const lessons = await lessonsCollection.find().toArray();
        res.json(lessons);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch lessons' });
      }
    });


    // DASHBOARD STATS ENDPOINT
    // GET /dashboard/stats?email=user@example.com&userId=123
    app.get('/dashboard/stats', async (req, res) => {
      try {
        const { email, userId } = req.query;

        if (!email && !userId) {
          return res.status(400).json({ error: 'Email or userId query parameter is required' });
        }

        // 1. Count lessons created by this user
        const createdCount = await lessonsCollection.countDocuments({
          'creator.email': email
        });

        // 2. Count lessons SAVED by this user (where favoritedBy array contains userId OR email)
        const savedCount = await lessonsCollection.countDocuments({
          $or: [
            { favoritedBy: email },
            { favoritedBy: userId }
          ]
        });

        return res.status(200).json({
          createdCount,
          savedCount
        });
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        return res.status(500).json({ error: 'Failed to fetch dashboard stats' });
      }
    });

    // GET: Recent Lessons
    app.get('/dashboard/recent-lessons', async (req, res) => {
      try {
        const { email, limit = 5 } = req.query;
        if (!email) {
          return res.status(400).json({ error: 'Email query parameter is required' });
        }

        const recentLessons = await lessonsCollection
          .find({ 'creator.email': email })
          .sort({ createdAt: -1, _id: -1 })
          .limit(parseInt(limit))
          .toArray();

        return res.status(200).json(recentLessons);
      } catch (error) {
        console.error('Error fetching recent lessons:', error);
        return res.status(500).json({ error: 'Failed to fetch recent lessons' });
      }
    });

    // GET: User Info by Email
    app.get('/users/email/:email', async (req, res) => {
      try {
        const { email } = req.params;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
      } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Failed to fetch user' });
      }
    });

    // GET: Favorited lessons for a specific user
    app.get('/dashboard/my-favorites/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const userEmail = req.query.email;

        const favorites = await lessonsCollection.find({
          $or: [
            { favoritedBy: userId },
            { favoritedBy: userEmail }
          ]
        }).toArray();

        res.json(favorites || []);
      } catch (error) {
        console.error('Error fetching favorites:', error);
        res.status(500).json({ message: 'Failed to fetch favorite lessons' });
      }
    });

    // GET: Single lesson by ID
    app.get('/dashboard/lessons/:id', async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid ID format' });
        }

        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) {
          return res.status(404).json({ error: 'Lesson not found' });
        }
        res.json(lesson);
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch lesson' });
      }
    });


    /**
 * @route   GET /dashboard/lessons/user/:userId
 * @desc    Fetch all lessons created by a specific user ID or Email
 */
    app.get('/dashboard/lessons/user/:userId', async (req, res) => {
      try {
        const { userId } = req.params;

        // Search by creator.userId or creator.email in case lessons store either identifier
        const userLessons = await lessonsCollection.find({
          $or: [
            { 'creator.userId': userId },
            { 'creator.email': userId }
          ]
        }).sort({ createdAt: -1 }).toArray();

        res.json(userLessons);
      } catch (error) {
        console.error('Error fetching creator lessons:', error);
        res.status(500).json({ error: 'Failed to fetch creator lessons' });
      }
    });

    // PATCH: Remove from favorites
    app.patch('/dashboard/my-favorites/remove', async (req, res) => {
      try {
        const { lessonId, userId } = req.body;
        if (!ObjectId.isValid(lessonId)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        await lessonsCollection.updateOne(
          { _id: new ObjectId(lessonId) },
          {
            $pull: { favoritedBy: userId },
            $inc: { favoritesCount: -1 }
          }
        );

        res.json({ success: true, message: 'Removed from favorites' });
      } catch (error) {
        console.error('Error removing favorite:', error);
        res.status(500).json({ message: 'Failed to remove favorite' });
      }
    });

    // ==========================================
    // 💬 COMMENTS ROUTES
    // ==========================================

    /**
     * @route   POST /dashboard/lessons/:id/comments
     * @desc    Add a comment to a lesson
     */
    app.post('/dashboard/lessons/:id/comments', async (req, res) => {
      try {
        const { id } = req.params;
        const { text, userEmail, userName, userImage } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        const newComment = {
          _id: new ObjectId(),
          text,
          userEmail,
          userName,
          userImage,
          createdAt: new Date().toISOString()
        };

        const result = await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $push: { comments: newComment },
            $inc: { commentsCount: 1 }
          }
        );

        res.status(201).json({ success: true, comment: newComment });
      } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
      }
    });

    /**
     * @route   GET /dashboard/lessons/:id/comments
     * @desc    Get all comments for a specific lesson
     */
    app.get('/dashboard/lessons/:id/comments', async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        const lesson = await lessonsCollection.findOne(
          { _id: new ObjectId(id) },
          { projection: { comments: 1 } }
        );

        res.json(lesson?.comments || []);
      } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
      }
    });

    // ==========================================
    // 👍 LIKES ROUTES
    // ==========================================

    /**
     * @route   PATCH /dashboard/lessons/:id/like
     * @desc    Toggle like status (Like / Unlike) on a lesson
     */
    app.patch('/dashboard/lessons/:id/like', async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, email } = req.body;
        const userIdentifier = userId || email;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) {
          return res.status(404).json({ error: 'Lesson not found' });
        }

        const isLiked = lesson.likedBy && lesson.likedBy.includes(userIdentifier);

        const updateQuery = isLiked
          ? { $pull: { likedBy: userIdentifier }, $inc: { likesCount: -1 } }
          : { $addToSet: { likedBy: userIdentifier }, $inc: { likesCount: 1 } };

        await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateQuery);

        res.status(200).json({
          success: true,
          isLiked: !isLiked,
          message: !isLiked ? 'Lesson liked' : 'Lesson unliked'
        });
      } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Failed to update like status' });
      }
    });

    // POST: Create New Lesson
    app.post('/dashboard/lessons', async (req, res) => {
      try {
        const lessonData = req.body;
        const result = await lessonsCollection.insertOne(lessonData);

        if (lessonData.creator?.email) {
          await usersCollection.updateOne(
            { email: lessonData.creator.email },
            {
              $inc: { lessonsCount: 1 },
              $set: { updatedAt: new Date() }
            }
          );
        }

        res.status(201).json({
          success: true,
          insertedId: result.insertedId
        });
      } catch (error) {
        console.error('Error creating lesson:', error);
        res.status(500).json({ message: 'Internal Server Error' });
      }
    });

    // PATCH: Favorite Toggle Endpoint
    app.patch('/dashboard/lessons/:id/favorite', async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, email } = req.body;
        const userIdentifier = userId || email;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }
        if (!userIdentifier) {
          return res.status(400).json({ error: 'User identifier is required' });
        }

        const lesson = await lessonsCollection.findOne({ _id: new ObjectId(id) });
        if (!lesson) {
          return res.status(404).json({ error: 'Lesson not found' });
        }

        const isFavorited = lesson.favoritedBy && lesson.favoritedBy.includes(userIdentifier);

        const updateQuery = isFavorited
          ? { $pull: { favoritedBy: userIdentifier }, $inc: { favoritesCount: -1 } }
          : { $addToSet: { favoritedBy: userIdentifier }, $inc: { favoritesCount: 1 } };

        await lessonsCollection.updateOne({ _id: new ObjectId(id) }, updateQuery);

        res.status(200).json({
          success: true,
          isFavorited: !isFavorited,
          message: !isFavorited ? 'Added to favorites' : 'Removed from favorites'
        });
      } catch (error) {
        console.error('Error toggling favorite:', error);
        res.status(500).json({ error: 'Failed to update favorite status' });
      }
    });

    // Start Express Server
    app.listen(port, () => {
      console.log(`LifeCoach Server running on port ${port}`);
    });

  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}

run().catch(console.dir);