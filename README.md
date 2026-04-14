# v2 Architecture

This repository hosts the architecture for the production-ready v2 implementation built using Vite and TypeScript. It encompasses key components such as the OAuth flow, encrypted token storage, and deployment strategies leveraging Cloudflare Workers.

## Architecture
- **OAuth Flow**: Streamlined authentication process leveraging standard OAuth2 protocols.
- **Token Management**: Encrypted tokens are stored securely using Cloudflare KV, while static credentials are managed via Cloudflare Secrets.
- **Cloudflare Workers**: The deployment strategy leverages Cloudflare Workers for a serverless architecture.
- **Compatibility**: Compatibility shims have been implemented to ensure integration with Activepieces-style community nodes.

## Usage
To get started, clone the repository and run the necessary build scripts. Detailed instructions for each component are provided within the relevant files.

## License
This project is licensed under the MIT License, see the [LICENSE](LICENSE) file for details.