<<<<<<< HEAD
const path = require('path');
// Load environment variables from the .env file in the same directory
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const express = require('express');
const twilio = require('twilio');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000; // Use Render's port or 3000 for local dev

// A simple in-memory store for OTPs. In a production app, use a database like Redis.
const otpStore = {};
// A simple in-memory store for user profiles.
const userStore = {};

// --- Twilio Configuration ---
// Securely load credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

// --- Configuration Validation ---
if (!accountSid || !authToken || !twilioPhoneNumber) {
    console.error('FATAL ERROR: Twilio credentials are not configured in the .env file.');
    process.exit(1); // Exit the process with an error code
}

const client = twilio(accountSid, authToken);

// --- Middleware ---

// --- CORS Configuration for Production ---
// Whitelist the domains that are allowed to make requests to this API.
const allowedOrigins = [
    // Add your Render frontend URL here. It might be something like:
    // 'https://textify-frontend.onrender.com', // Example if your frontend has its own URL
    'https://textify.onrender.com', // This might be your frontend URL
    'https://textify-app.onrender.com', // Or whatever your frontend URL is
    // For local development, you can keep these:
    'http://localhost:3000',
    'http://127.0.0.1:5500'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    }
}));

app.use(express.json()); // Middleware to parse JSON bodies

// --- API Endpoints ---

/**
 * @route   GET /
 * @desc    Serves the main phone verification page.
 */
app.get('/api', (req, res) => {
    // A dedicated health-check endpoint for the API.
    res.status(200).json({ message: 'Textify backend API is running.' });
});

/**
 * @route POST /api/send-otp
 * @desc Generates and sends an OTP to a phone number.
 */
app.post('/api/send-otp', async (req, res, next) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    try {
        // The Twilio Verify service is a better choice for OTPs than sending a raw SMS.
        // It handles OTP generation, delivery, and status checking.
        // You need to create a "Verify Service" in your Twilio console to get a VA... SID.
        // For now, we will stick to the manual SMS method as it's simpler to set up.

        // Generate a cryptographically secure 6-digit OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        console.log(`Generated OTP: ${otp} for phone number: ${phoneNumber}`);

        // Store the OTP with an expiry time (e.g., 5 minutes)
        const expiry = Date.now() + 5 * 60 * 1000;
        otpStore[phoneNumber] = { otp, expiry };

        // --- Send the SMS using Twilio ---
        const message = await client.messages.create({
            body: `Your Textify verification code is: ${otp}`,
            from: twilioPhoneNumber,
            to: phoneNumber
        });

        console.log('SMS sent successfully. SID:', message.sid);
        res.json({ success: true, message: 'OTP sent successfully.' });
    } catch (error) {
        console.error('Error sending SMS via Twilio:', error);
        // Pass the error to the centralized error handler
        error.clientMessage = 'Failed to send OTP. Please check the phone number and try again.';
        next(error);
    }
});

/**
 * @route POST /api/verify-otp
 * @desc Verifies the OTP submitted by the user.
 */
app.post('/api/verify-otp', (req, res) => {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
        return res.status(400).json({ success: false, message: 'Phone number and OTP are required.' });
    }

    const storedOtpData = otpStore[phoneNumber];

    if (!storedOtpData) {
        return res.status(400).json({ success: false, message: 'OTP not found. Please request a new one.' });
    }

    if (Date.now() > storedOtpData.expiry) {
        return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (storedOtpData.otp.toString() === otp) {
        delete otpStore[phoneNumber]; // OTP is used, so remove it
        return res.json({ success: true, message: 'Phone number verified successfully.' });
    } else {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }
});

// --- Multer Configuration for file uploads ---
// We only need this for profile routes, so we define it here.
const multer = require('multer');
const fs = require('fs');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)) { fs.mkdirSync(dir); }
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

/**
 * @route POST /api/profile
 * @desc Creates or updates a user's profile.
 */
app.post('/api/profile', upload.single('profilePicture'), (req, res) => {
    const { name, phoneNumber } = req.body;

    if (!name || !phoneNumber) {
        return res.status(400).json({ success: false, message: 'Name and phone number are required.' });
    }

    const profilePicturePath = req.file ? req.file.path : null;

    userStore[phoneNumber] = {
        name,
        profilePicture: profilePicturePath
    };

    console.log('Updated user profile:', userStore[phoneNumber]);
    res.json({ success: true, message: 'Profile updated successfully.' });
});

/**
 * @route PUT /api/profile/:phoneNumber
 * @desc Updates a user's profile (name, about, picture).
 */
app.put('/api/profile/:phoneNumber', upload.single('profilePicture'), (req, res) => {
    const { phoneNumber } = req.params;
    const { name, about } = req.body;
    const user = userStore[phoneNumber];

    if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Update fields if they are provided in the request
    if (name) {
        user.name = name;
    }
    if (about) {
        user.about = about;
    }
    if (req.file) {
        // In a real app, you might want to delete the old picture file from storage
        user.profilePicture = req.file.path;
    }

    console.log('User profile updated:', user);
    res.json({ success: true, message: 'Profile updated successfully.', user: userStore[phoneNumber] });
});

/**
 * @route GET /api/profile/:phoneNumber
 * @desc Retrieves a user's profile.
 */
app.get('/api/profile/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;
    const user = userStore[phoneNumber];
    user ? res.json({ success: true, user }) : res.status(404).json({ success: false, message: 'User not found.' });
});

// --- Centralized Error Handling Middleware ---
// This should be the last middleware added.
app.use((err, req, res, next) => {
    console.error(err.stack); // Log the full error stack for debugging

    // Send a generic message to the client to avoid leaking implementation details
    const clientMessage = err.clientMessage || 'An internal server error occurred.';
    const statusCode = err.statusCode || 500;

    res.status(statusCode).json({ success: false, message: clientMessage });
});

// --- Static File Serving ---
// Serve the 'uploads' directory for profile pictures
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Serve the frontend files from a 'public' or 'frontend' directory
// This assumes your HTML/JS/CSS files are in a directory at the root of your project.
app.use(express.static(path.join(__dirname, '..', 'public')));


// --- Start the Server ---
app.listen(port, () => {
    console.log(`Textify backend server listening at http://localhost:${port}`);
});
