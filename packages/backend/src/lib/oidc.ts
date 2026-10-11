import type { Request } from 'express';
import passport from 'passport';
import type * as OidcClient from 'openid-client';
import { oidcSettings, type OidcSettings, safeReturnTo } from './oidc-config';
import { resolveOidcUser } from './oidc-user';

interface OidcTransaction {
  state: string;
  nonce: string;
  verifier: string;
  createdAt: number;
  returnTo: string;
}

declare module 'express-session' {
  interface SessionData {
    oidc?: OidcTransaction;
  }
}

const MAX_AUTH_AGE = 10 * 60 * 1000;

export class OidcStrategy extends passport.Strategy {
  name = 'oidc';
  private configuration?: Promise<OidcClient.Configuration>;

  constructor(private settings: OidcSettings) {
    super();
  }

  private async client() {
    // Node >=22.12 supports require(ESM); lazy loading also leaves local login
    // independent of provider availability and avoids discovery at startup.
    const client: typeof OidcClient = require('openid-client');
    if (!this.configuration) {
      this.configuration = client.discovery(
        new URL(this.settings.issuer),
        this.settings.clientId,
        this.settings.clientSecret,
        client.ClientSecretBasic(this.settings.clientSecret),
        { timeout: 10, execute: [client.enableNonRepudiationChecks] },
      ).catch(() => {
        this.configuration = undefined;
        throw new Error('OIDC discovery failed');
      });
    }
    return { client, config: await this.configuration };
  }

  authenticate(req: Request): void {
    void this.run(req).catch(() => {
      // Provider exceptions can contain tokens or URLs with authorization codes.
      this.error(new Error('OIDC authentication failed'));
    });
  }

  private async run(req: Request) {
    if (!req.session) throw new Error('OIDC requires a session');
    if (req.path === '/oidc') {
      const { client, config } = await this.client();
      const transaction: OidcTransaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        verifier: client.randomPKCECodeVerifier(),
        createdAt: Date.now(),
        returnTo: safeReturnTo(req.query.returnTo),
      };
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: this.settings.redirectUri,
        scope: this.settings.scopes,
        response_type: 'code',
        response_mode: 'query',
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(transaction.verifier),
        code_challenge_method: 'S256',
      });
      req.session.oidc = transaction;
      await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
      this.redirect(url.href);
      return;
    }

    const transaction = req.session.oidc;
    delete req.session.oidc;
    // Persist consumption before any network request or login session rotation.
    await new Promise<void>((resolve, reject) => req.session.save((err) => err ? reject(err) : resolve()));
    if (!transaction || Date.now() - transaction.createdAt > MAX_AUTH_AGE ||
        transaction.createdAt > Date.now()) {
      this.fail({ message: 'OIDC login expired or missing' }, 401);
      return;
    }
    const { client, config } = await this.client();
    const currentUrl = new URL(this.settings.redirectUri);
    // The configured redirect URI is authoritative, not Host/Forwarded headers.
    currentUrl.search = new URL(req.originalUrl, 'https://request.invalid').search;
    const tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: transaction.verifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    const user = claims && await resolveOidcUser(
      this.settings.issuer,
      claims,
      (subject) => client.fetchUserInfo(config, tokens.access_token, subject),
    );
    if (!user) {
      this.fail({ message: 'OIDC account not permitted' }, 401);
      return;
    }
    this.success(user, { returnTo: transaction.returnTo });
  }
}

export function registerOidcStrategy(): void {
  if (oidcSettings) passport.use(new OidcStrategy(oidcSettings));
}
