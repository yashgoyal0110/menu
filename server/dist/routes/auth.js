import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, signToken, verifyPassword } from '../lib/auth.js';
import { generateOtp, OTP_TTL_MS, sendOtpEmail, sendPasswordResetEmail } from '../lib/email.js';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../prisma.js';
const router = Router();
const resetRequestTimes = new Map();
const resetAttempts = new Map();
const RESET_REQUEST_COOLDOWN_MS = 60_000;
const RESET_ATTEMPT_WINDOW_MS = 10 * 60_000;
const RESET_ATTEMPT_LIMIT = 5;
const strongPassword = z.string().min(10).max(200)
    .regex(/[A-Z]/, 'Password needs an uppercase letter.')
    .regex(/[a-z]/, 'Password needs a lowercase letter.')
    .regex(/\d/, 'Password needs a number.')
    .regex(/[^A-Za-z0-9]/, 'Password needs a symbol.');
const registerSchema = z.object({
    name: z.string().min(1).max(120),
    email: z.string().email(),
    password: strongPassword,
});
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
});
const verifySchema = z.object({
    email: z.string().email(),
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});
const resendSchema = z.object({
    email: z.string().email(),
});
const forgotPasswordSchema = z.object({ email: z.string().email() });
const resetPasswordSchema = z.object({
    email: z.string().email(),
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
    password: strongPassword,
});
/** Sets a fresh OTP on the user and emails it. */
async function issueOtp(user) {
    const code = generateOtp();
    await db.user.update({
        where: { id: user.id },
        data: { otpCode: code, otpExpiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    await sendOtpEmail(user.email, user.name, code);
}
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
function setAuthCookie(res, token) {
    res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: SEVEN_DAYS_MS,
        path: '/',
    });
}
router.post('/register', async (req, res, next) => {
    try {
        const input = registerSchema.parse(req.body);
        const email = input.email.toLowerCase();
        const existing = await db.user.findUnique({ where: { email } });
        if (existing) {
            res.status(409).json({ error: 'An account with that email already exists.' });
            return;
        }
        const userId = randomUUID();
        const passwordHash = await hashPassword(input.password);
        const user = await db.user.create({
            data: {
                userId,
                email,
                name: input.name,
                imageUrl: '',
                passwordHash,
                emailVerified: false,
            },
        });
        // Send a verification code; the account is not usable until verified.
        await issueOtp(user);
        res.status(201).json({ needsVerification: true, email: user.email });
    }
    catch (err) {
        next(err);
    }
});
router.post('/verify', async (req, res, next) => {
    try {
        const input = verifySchema.parse(req.body);
        const email = input.email.toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        if (!user) {
            res.status(404).json({ error: 'Account not found.' });
            return;
        }
        if (user.emailVerified) {
            res.status(400).json({ error: 'This email is already verified. Please sign in.' });
            return;
        }
        if (!user.otpCode ||
            !user.otpExpiresAt ||
            user.otpExpiresAt.getTime() < Date.now()) {
            res.status(400).json({ error: 'Your code has expired. Request a new one.' });
            return;
        }
        if (user.otpCode !== input.code) {
            res.status(400).json({ error: 'Incorrect code. Please try again.' });
            return;
        }
        const verified = await db.user.update({
            where: { id: user.id },
            data: { emailVerified: true, otpCode: null, otpExpiresAt: null },
        });
        const token = signToken({ sub: verified.id, userId: verified.userId });
        setAuthCookie(res, token);
        res.json({
            user: { id: verified.id, name: verified.name, email: verified.email },
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/resend', async (req, res, next) => {
    try {
        const input = resendSchema.parse(req.body);
        const email = input.email.toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        // Always respond ok — don't reveal whether the email exists.
        if (user && !user.emailVerified) {
            await issueOtp(user);
        }
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/login', async (req, res, next) => {
    try {
        const input = loginSchema.parse(req.body);
        const email = input.email.toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }
        const ok = await verifyPassword(input.password, user.passwordHash);
        if (!ok) {
            res.status(401).json({ error: 'Invalid email or password.' });
            return;
        }
        if (!user.emailVerified) {
            // Re-issue a code so the client can take them straight to verification.
            await issueOtp(user);
            res.status(403).json({
                error: 'Please verify your email. We sent you a new code.',
                needsVerification: true,
                email: user.email,
            });
            return;
        }
        const token = signToken({ sub: user.id, userId: user.userId });
        setAuthCookie(res, token);
        res.json({ user: { id: user.id, name: user.name, email: user.email } });
    }
    catch (err) {
        next(err);
    }
});
router.post('/forgot-password', async (req, res, next) => {
    try {
        const { email: rawEmail } = forgotPasswordSchema.parse(req.body);
        const email = rawEmail.toLowerCase();
        const lastRequest = resetRequestTimes.get(email) ?? 0;
        if (Date.now() - lastRequest < RESET_REQUEST_COOLDOWN_MS) {
            res.json({ ok: true });
            return;
        }
        resetRequestTimes.set(email, Date.now());
        const user = await db.user.findUnique({ where: { email } });
        // Do not reveal whether an account exists.
        if (user?.emailVerified && user.passwordHash) {
            const code = generateOtp();
            await db.user.update({
                where: { id: user.id },
                data: { otpCode: code, otpExpiresAt: new Date(Date.now() + OTP_TTL_MS) },
            });
            await sendPasswordResetEmail(user.email, user.name, code);
        }
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/reset-password', async (req, res, next) => {
    try {
        const input = resetPasswordSchema.parse(req.body);
        const email = input.email.toLowerCase();
        const existingAttempts = resetAttempts.get(email);
        const attempts = !existingAttempts || existingAttempts.resetsAt < Date.now()
            ? { count: 0, resetsAt: Date.now() + RESET_ATTEMPT_WINDOW_MS }
            : existingAttempts;
        if (attempts.count >= RESET_ATTEMPT_LIMIT) {
            res.status(429).json({ error: 'Too many attempts. Request a new code in a few minutes.' });
            return;
        }
        const user = await db.user.findUnique({ where: { email } });
        if (!user?.otpCode || !user.otpExpiresAt || user.otpExpiresAt.getTime() < Date.now() || user.otpCode !== input.code) {
            resetAttempts.set(email, { ...attempts, count: attempts.count + 1 });
            res.status(400).json({ error: 'The recovery code is invalid or expired.' });
            return;
        }
        await db.user.update({
            where: { id: user.id },
            data: {
                passwordHash: await hashPassword(input.password),
                otpCode: null,
                otpExpiresAt: null,
            },
        });
        res.clearCookie('token', { path: '/' });
        resetAttempts.delete(email);
        resetRequestTimes.delete(email);
        res.json({ ok: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/logout', (_req, res) => {
    res.clearCookie('token', { path: '/' });
    res.json({ ok: true });
});
router.get('/me', requireAuth, async (req, res, next) => {
    try {
        const user = await db.user.findUnique({
            where: { id: req.auth?.id },
            select: { id: true, name: true, email: true, imageUrl: true },
        });
        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }
        res.json({ user });
    }
    catch (err) {
        next(err);
    }
});
export default router;
//# sourceMappingURL=auth.js.map