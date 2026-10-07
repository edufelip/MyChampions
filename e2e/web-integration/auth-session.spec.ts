import { URL } from 'node:url';
import { expect, test } from '@playwright/test';
import { integrationCase } from './support';
import type { Response } from '@playwright/test';

test('@integration:auth-session account, onboarding, reload and revocation', async ({
  page,
  context,
  browser,
}, info) => {
  const attempt = await integrationCase('auth-session', info, browser);
  const { appOrigin, apiOrigin, runId } = attempt.context;
  // The server's "new" fixture is already unonboarded; signup needs a genuinely absent email.
  const email = `signup-${runId}-${info.project.name}@example.test`;
  const password = `${attempt.fixtures.accounts.new.password}1`;
  const name = `QA signup ${info.project.name}`;
  let accessToken = '';
  const origins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (/^\/(auth|me|plans|connections)(\/|$)/.test(url.pathname) && url.origin !== appOrigin) {
      origins.add(url.origin);
      const header = request.headers().authorization;
      if (header?.startsWith('Bearer ')) accessToken = header.slice(7);
    }
  });
  const readyHome = async () => {
    const home = page.getByTestId('student.home.screen').last();
    await expect(home).toBeVisible();
    await expect(home.getByTestId('student.home.ready')).toBeVisible();
    await expect(home.getByTestId('student.home.error')).toHaveCount(0);
  };
  await attempt.assert('create-account-login', async () => {
    await page.goto('/auth/create-account');
    await page.getByTestId('auth.createAccount.nameInput').fill(name);
    await page.getByTestId('auth.createAccount.emailInput').fill(email);
    await page.getByTestId('auth.createAccount.passwordInput').fill(password);
    await page.getByTestId('auth.createAccount.passwordConfirmationInput').fill(password);
    const create = page.waitForResponse(
      (response) => response.url() === `${apiOrigin}/auth/email/create-account`,
    );
    let loginResponse: Response | undefined;
    const captureLogin = (response: Response) => {
      if (response.url() === `${apiOrigin}/auth/email/sign-in`) loginResponse = response;
    };
    page.on('response', captureLogin);
    await page.getByTestId('auth.createAccount.submitButton').click();
    const created = await create;
    if (created.status() === 202) {
      expect(await created.json()).toMatchObject({ status: 'accepted' });
      const login =
        loginResponse ??
        (await page.waitForResponse(
          (response) => response.url() === `${apiOrigin}/auth/email/sign-in`,
        ));
      expect(login.status()).toBe(201);
    } else {
      // SC-218 explicitly retains compatible servers that return a session directly.
      expect(created.status()).toBe(201);
      const session = (await created.json()) as {
        accessToken?: string;
        profile?: { emailNormalized?: string };
      };
      expect(typeof session.accessToken).toBe('string');
      expect(session.profile?.emailNormalized).toBe(email);
    }
    page.off('response', captureLogin);
    await expect(page.getByTestId('auth.terms.screen')).toBeVisible({ timeout: 30_000 });
  });
  await attempt.assert('terms-role-persisted', async () => {
    await expect(page.getByTestId('auth.terms.acceptButton.disabled')).toBeDisabled();
    await page.getByTestId('auth.terms.checkbox').click();
    await page.getByTestId('auth.terms.acceptButton').click();
    await expect(page.getByTestId('auth.roleSelection.screen')).toBeVisible();
    await expect(page.getByTestId('auth.roleSelection.continueButton')).toBeDisabled();
    await page.getByTestId('auth.roleSelection.studentCard').click();
    await page.getByTestId('auth.roleSelection.continueButton').click();
    await readyHome();
    expect(accessToken).toBeTruthy();
    const profile = await context.request.get(`${apiOrigin}/me`, {
      headers: { origin: appOrigin, authorization: `Bearer ${accessToken}` },
    });
    expect(profile.status()).toBe(200);
    const body = (await profile.json()) as {
      profile: { emailNormalized: string; lockedRole: string; acceptedTermsVersion: string };
    };
    expect(body.profile).toMatchObject({
      emailNormalized: email,
      lockedRole: 'student',
      acceptedTermsVersion: 'v1',
    });
  });
  const initialCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'mychampions_refresh_token',
  );
  await attempt.assert('http-only-cookie', async () => {
    expect(initialCookie).toMatchObject({
      httpOnly: true,
      path: '/auth/session',
      sameSite: 'Lax',
      secure: false,
    });
    const storage = await page.evaluate(() => ({
      local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(initialCookie!.value);
    expect(JSON.stringify(storage)).not.toContain('refreshToken');
  });
  await attempt.assert('reload-session-rotation', async () => {
    await page.reload();
    await readyHome();
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === 'mychampions_refresh_token',
    );
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.value).not.toBe(initialCookie?.value);
  });
  const revocationCookie = (await context.cookies()).find(
    (cookie) => cookie.name === 'mychampions_refresh_token',
  );
  await attempt.assert('sign-out-revocation', async () => {
    await page.getByTestId('tabs.account').last().click();
    await page.getByTestId('settings.account.signOutCta').click();
    const signOut = page.waitForResponse(
      (response) => response.url() === `${apiOrigin}/auth/session/sign-out`,
    );
    await page.getByTestId('settings.account.signOutConfirmCta').click();
    expect((await signOut).status()).toBe(204);
    await expect(page.getByTestId('auth.signIn.title')).toBeVisible();
    expect(
      (await context.cookies()).some((cookie) => cookie.name === 'mychampions_refresh_token'),
    ).toBe(false);
    const replay = await fetch(`${apiOrigin}/auth/session/refresh`, {
      method: 'POST',
      headers: {
        origin: appOrigin,
        'content-type': 'application/json',
        cookie: `mychampions_refresh_token=${revocationCookie!.value}`,
      },
      body: JSON.stringify({ sessionMode: 'cookie' }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    expect(replay.status).toBe(401);
  });
  await attempt.assert('normal-login-restore', async () => {
    await page.getByTestId('auth.signIn.emailInput').fill(email);
    await page.getByTestId('auth.signIn.passwordInput').fill(password);
    await page.getByTestId('auth.signIn.submitButton').click();
    await readyHome();
    await page.reload();
    await readyHome();
  });
  await attempt.assert('owned-client-origin', async () => {
    expect([...origins]).toEqual([apiOrigin]);
    await page.screenshot({
      path: `${attempt.context.artifactRoot}/attempts/${attempt.selected.attemptId}.home.png`,
    });
  });
});
