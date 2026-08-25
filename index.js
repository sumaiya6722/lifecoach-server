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


//////Manage User ///////////////////////
    /**
 * @route   GET /admin/lessons
 * @desc    Fetch all lessons with filtering & overall admin stats
 */
    app.get('/admin/lessons', async (req, res) => {
      try {
        const { category, visibility, flagged } = req.query;

        // Build Mongo Query Filter
        const filter = {};

        if (category && category !== 'All') {
          filter.category = category;
        }

        if (visibility && visibility !== 'All') {
          filter.accessLevel = visibility; // e.g., 'Public', 'Private', 'Premium'
        }

        if (flagged === 'true') {
          filter.$or = [{ isReported: true }, { reportsCount: { $gt: 0 } }];
        }

        // Fetch filtered lessons
        const lessons = await lessonsCollection.find(filter).sort({ createdAt: -1 }).toArray();

        // Fetch overall counts for header stats
        const publicCount = await lessonsCollection.countDocuments({ accessLevel: 'Public' });
        const privateCount = await lessonsCollection.countDocuments({ accessLevel: 'Private' });
        const flaggedCount = await lessonsCollection.countDocuments({
          $or: [{ isReported: true }, { reportsCount: { $gt: 0 } }]
        });

        res.status(200).json({
          lessons,
          stats: {
            publicCount,
            privateCount,
            flaggedCount
          }
        });
      } catch (error) {
        console.error('Error fetching admin lessons:', error);
        res.status(500).json({ error: 'Failed to fetch lessons' });
      }
    });

    /**
     * @route   PATCH /admin/lessons/:id/featured
     * @desc    Toggle featured status of a lesson
     */
    app.patch('/admin/lessons/:id/featured', async (req, res) => {
      try {
        const { id } = req.params;
        const { isFeatured } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isFeatured: Boolean(isFeatured) } }
        );

        res.status(200).json({ success: true, isFeatured: Boolean(isFeatured) });
      } catch (error) {
        console.error('Error updating featured status:', error);
        res.status(500).json({ error: 'Failed to update featured status' });
      }
    });

    /**
     * @route   PATCH /admin/lessons/:id/reviewed
     * @desc    Mark reported content as reviewed (clears flags)
     */
    app.patch('/admin/lessons/:id/reviewed', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { isReported: false, isReviewed: true },
            $unset: { reports: "" }
          }
        );

        res.status(200).json({ success: true, message: 'Lesson marked as reviewed' });
      } catch (error) {
        console.error('Error marking lesson as reviewed:', error);
        res.status(500).json({ error: 'Failed to update review status' });
      }
    });

    /**
     * @route   DELETE /admin/lessons/:id
     * @desc    Delete an inappropriate lesson
     */
    app.delete('/admin/lessons/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        const result = await lessonsCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'Lesson not found' });
        }

        res.status(200).json({ success: true, message: 'Lesson deleted successfully' });
      } catch (error) {
        console.error('Error deleting lesson:', error);
        res.status(500).json({ error: 'Failed to delete lesson' });
      }
    });
///////////////manage user///////////////


    /**
 * @route   GET /homepage/top-contributors-week
 * @desc    Fetch Top Contributors of the Week (last 7 days)
 */
    app.get('/homepage/top-contributors-week', async (req, res) => {
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const contributors = await lessonsCollection.aggregate([
          {
            $match: {
              createdAt: { $gte: sevenDaysAgo.toISOString() }
            }
          },
          {
            $group: {
              _id: "$creator.email",
              name: { $first: "$creator.name" },
              photoURL: { $first: "$creator.photoURL" },
              userId: { $first: "$creator.userId" },
              recentLessonsCount: { $sum: 1 }
            }
          },
          { $sort: { recentLessonsCount: -1 } },
          { $limit: 4 }
        ]).toArray();

        res.status(200).json(contributors);
      } catch (error) {
        console.error('Error fetching weekly top contributors:', error);
        res.status(500).json({ error: 'Failed to fetch weekly contributors' });
      }
    });

    /**
     * @route   GET /homepage/most-saved-lessons
     * @desc    Fetch top lessons sorted by favorites count
     */
    app.get('/homepage/most-saved-lessons', async (req, res) => {
      try {
        const lessons = await lessonsCollection.find({})
          .sort({ favoritesCount: -1 })
          .limit(6)
          .toArray();

        res.status(200).json(lessons);
      } catch (error) {
        console.error('Error fetching most saved lessons:', error);
        res.status(500).json({ error: 'Failed to fetch most saved lessons' });
      }
    });

    /**
 * @route   GET /admin/stats
 * @desc    Fetch platform-wide analytics for admin dashboard
 */
    app.get('/admin/stats', async (req, res) => {
      try {
        // 1. Core Platform Counts
        const totalUsers = await usersCollection.countDocuments();
        const totalPublicLessons = await lessonsCollection.countDocuments({
          accessLevel: { $ne: 'Premium' }
        });

        // Lessons flagged by report count or isReported status
        const totalReportedLessons = await lessonsCollection.countDocuments({
          $or: [{ isReported: true }, { reportsCount: { $gt: 0 } }]
        });

        // 2. Today's New Lessons
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const todaysNewLessons = await lessonsCollection.countDocuments({
          createdAt: { $gte: startOfToday.toISOString() }
        });

        // 3. Most Active Contributors (Top 5 users by created lessons)
        const mostActiveContributors = await lessonsCollection.aggregate([
          {
            $group: {
              _id: "$creator.email",
              name: { $first: "$creator.name" },
              photoURL: { $first: "$creator.photoURL" },
              lessonCount: { $sum: 1 }
            }
          },
          { $sort: { lessonCount: -1 } },
          { $limit: 5 }
        ]).toArray();

        // 4. Monthly Lesson & User Growth Data (Simulated Aggregation for Charts)
        const lessonGrowth = await lessonsCollection.aggregate([
          {
            $group: {
              _id: { $substr: ["$createdAt", 0, 7] }, // Group by YYYY-MM
              count: { $sum: 1 }
            }
          },
          { $sort: { "_id": 1 } },
          { $limit: 6 }
        ]).toArray();

        res.status(200).json({
          totalUsers,
          totalPublicLessons,
          totalReportedLessons,
          todaysNewLessons,
          mostActiveContributors,
          growthData: {
            lessonGrowth: lessonGrowth.map(item => ({ month: item._id, count: item.count }))
          }
        });

      } catch (error) {
        console.error('Error fetching admin stats:', error);
        res.status(500).json({ error: 'Failed to retrieve admin stats' });
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



    /**
 * @route   GET /admin/users
 * @desc    Fetch all users with their total created lessons count
 */
    app.get('/admin/users', async (req, res) => {
      try {
        const users = await usersCollection.aggregate([
          {
            $lookup: {
              from: 'lessons',
              let: { userEmail: '$email', userId: { $toString: '$_id' } },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $or: [
                        { $eq: ['$creator.email', '$$userEmail'] },
                        { $eq: ['$creator.userId', '$$userId'] }
                      ]
                    }
                  }
                }
              ],
              as: 'createdLessons'
            }
          },
          {
            $project: {
              name: 1,
              email: 1,
              role: 1,
              image: 1,
              photoURL: 1,
              totalLessons: { $size: '$createdLessons' }
            }
          }
        ]).toArray();

        res.status(200).json(users);
      } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
      }
    });

    /**
     * @route   PATCH /admin/users/:id/role
     * @desc    Update a user's role (e.g., user -> admin)
     */
    app.patch('/admin/users/:id/role', async (req, res) => {
      try {
        const { id } = req.params;
        const { role } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid User ID' });
        }

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { role } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'User not found or role unchanged' });
        }

        res.status(200).json({ success: true, message: 'Role updated successfully' });
      } catch (error) {
        console.error('Error updating role:', error);
        res.status(500).json({ error: 'Failed to update role' });
      }
    });

    /**
     * @route   DELETE /admin/users/:id
     * @desc    Delete a user account
     */
    app.delete('/admin/users/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid User ID' });
        }

        const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json({ success: true, message: 'User deleted successfully' });
      } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user' });
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
          text: text || '',
          userEmail: userEmail || 'Anonymous',
          userName: userName || 'Anonymous User',
          userImage: userImage || '',
          createdAt: new Date().toISOString()
        };

        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $push: { comments: newComment },
            $inc: { commentsCount: 1 }
          }
        );

        // Explicitly return the newComment object inside response
        res.status(201).json({ success: true, comment: newComment });
      } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
      }
    });

    /**
 * @route   POST /dashboard/lessons/:id/report
 * @desc    Report a lesson and increment total report count
 */
    app.post('/dashboard/lessons/:id/report', async (req, res) => {
      try {
        const { id } = req.params;
        const { userId, email, reason } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid lesson ID' });
        }

        const reportEntry = {
          _id: new ObjectId(),
          reportedBy: userId || email || 'Anonymous',
          email: email || '',
          reason: reason || 'Inappropriate Content',
          createdAt: new Date().toISOString()
        };

        // Store individual report AND increment overall reportsCount counter
        await lessonsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $push: { reports: reportEntry },
            $inc: { reportsCount: 1 },
            $set: { isReported: true }
          }
        );

        res.status(200).json({ success: true, message: 'Report submitted successfully' });
      } catch (error) {
        console.error('Error reporting lesson:', error);
        res.status(500).json({ error: 'Failed to submit report' });
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