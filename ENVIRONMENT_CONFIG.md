# Environment-Based Configuration

This application now supports environment-based configuration to switch between development and production settings.

## Configuration Files

- `app/lib/dev-config.ts` - Development configuration (DynamoDB tables with "-dev-" prefix)
- `app/lib/prod-config.ts` - Production configuration (DynamoDB tables with "-prod-" prefix)
- `app/lib/config.ts` - Main configuration loader that selects the appropriate config based on environment

## Usage

The application automatically loads the appropriate configuration based on the `environment` environment variable:

### Development Environment (default)
```bash
# No environment variable needed, defaults to dev
npm run dev
```

### Production Environment
```bash
# Set environment variable to 'prod'
environment=prod npm run build
environment=prod npm start
```

## Configuration Differences

| Setting | Development | Production |
|---------|-------------|------------|
| DynamoDB Tables | `mtn-nigeria-dev-*` | `mtn-nigeria-prod-*` |
| S3 Bucket | `mtn-nigeria-dev-bucket` | `mtn-nigeria-prod-bucket` |
| Session Secret | `default_secret` | `prod_secret` |

## Adding New Configuration

When adding new configuration values:

1. Add the value to both `dev-config.ts` and `prod-config.ts`
2. Export the value from `config.ts`
3. Import from `config.ts` in your application code

Example:
```typescript
// In dev-config.ts and prod-config.ts
export const NEW_SETTING = "dev-value"; // or "prod-value"

// In config.ts
export const { NEW_SETTING, /* other exports */ } = config;

// In your application
import { NEW_SETTING } from "./lib/config";
``` 