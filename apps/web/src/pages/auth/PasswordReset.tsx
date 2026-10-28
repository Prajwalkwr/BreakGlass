import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { forgotPasswordSchema, passwordSchema, resetPasswordSchema } from '@breakglass/shared';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Field, Input, InlineNotice } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

export function ForgotPassword() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof forgotPasswordSchema>>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await api.post<{ message: string; emailConfigured: boolean }>('/auth/forgot-password', values);
      setMessage(response.message);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Could not request a reset link.');
    }
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you use for BreakGlass and we will send a reset link."
      footer={
        <Link to="/login" className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {message ? <InlineNotice tone="info">{message}</InlineNotice> : null}
        {error ? <InlineNotice tone="critical">{error}</InlineNotice> : null}

        <Field label="Email" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@agency.com" invalid={Boolean(errors.email)} {...register('email')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

const resetFormSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetFormSchema>>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      resetPasswordSchema.parse({ token, password: values.password });
      await api.post('/auth/reset-password', { token, password: values.password });
      setDone(true);
      window.setTimeout(() => navigate('/login', { replace: true }), 2200);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'This reset link is invalid or has expired.');
    }
  });

  return (
    <AuthLayout
      title={done ? 'Password updated' : 'Choose a new password'}
      subtitle={done ? 'You can now sign in with your new password.' : 'Pick something you have not used before.'}
      footer={
        <Link to="/login" className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <InlineNotice tone="warning">
          This page needs a reset token. Open the link from your email, or{' '}
          <Link to="/forgot-password" className="underline">
            request a new one
          </Link>
          .
        </InlineNotice>
      ) : done ? (
        <InlineNotice tone="success">All other sessions have been signed out for safety.</InlineNotice>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? <InlineNotice tone="critical">{error}</InlineNotice> : null}
          <Field label="New password" htmlFor="password" required error={errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" invalid={Boolean(errors.password)} {...register('password')} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword" required error={errors.confirmPassword?.message}>
            <Input id="confirmPassword" type="password" autoComplete="new-password" invalid={Boolean(errors.confirmPassword)} {...register('confirmPassword')} />
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'idle' | 'working' | 'ok' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const verify = async () => {
    setState('working');
    try {
      await api.post('/auth/verify-email', { token });
      setState('ok');
    } catch (caught) {
      setState('error');
      setMessage(caught instanceof ApiRequestError ? caught.message : 'Verification failed.');
    }
  };

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle="Verifying your address keeps workspace and alert emails reliable."
      footer={
        <Link to="/app" className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900">
          Go to dashboard
        </Link>
      }
    >
      <div className="space-y-4">
        {!token ? (
          <InlineNotice tone="warning">This page needs a verification token from your email.</InlineNotice>
        ) : state === 'ok' ? (
          <InlineNotice tone="success">Your email address is confirmed.</InlineNotice>
        ) : (
          <>
            {state === 'error' ? <InlineNotice tone="critical">{message}</InlineNotice> : null}
            <Button size="lg" className="w-full" loading={state === 'working'} onClick={() => void verify()}>
              Confirm email address
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
