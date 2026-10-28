import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { loginSchema } from '@breakglass/shared';
import { z } from 'zod';
import { api, ApiRequestError } from '../../lib/api';
import { Button, Field, Input, InlineNotice } from '../../components/ui';
import { AuthLayout } from './AuthLayout';

type FormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/app';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/login', values);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(redirectTo, { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Sign in failed. Try again.');
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Your monitoring kept running while you were away."
      footer={
        <>
          New to BreakGlass?{' '}
          <Link to="/signup" className="font-medium text-ink-900 underline decoration-ink-300 underline-offset-4 hover:decoration-ink-900">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error ? <InlineNotice tone="critical">{error}</InlineNotice> : null}

        <Field label="Email" htmlFor="email" required error={errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" placeholder="you@agency.com" invalid={Boolean(errors.email)} {...register('email')} />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          required
          error={errors.password?.message}
          hint={
            <Link to="/forgot-password" className="text-ink-600 underline decoration-paper-400 underline-offset-2 hover:text-ink-900 hover:decoration-ink-400">
              Forgot your password?
            </Link>
          }
        >
          <Input id="password" type="password" autoComplete="current-password" invalid={Boolean(errors.password)} {...register('password')} />
        </Field>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
