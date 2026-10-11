CREATE TABLE "OidcIdentity" (
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "OidcIdentity_pkey" PRIMARY KEY ("issuer", "subject")
);

CREATE UNIQUE INDEX "OidcIdentity_issuer_userId_key" ON "OidcIdentity"("issuer", "userId");

ALTER TABLE "OidcIdentity" ADD CONSTRAINT "OidcIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
