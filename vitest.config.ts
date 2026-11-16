import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    // The cores and holders the tests start must never read the developer's real Claude, Copilot or OpenCode records for the usage history.
    env: { CLAUDE_CONFIG_DIR: '/nonexistent/grove-test-claude', COPILOT_HOME: '/nonexistent/grove-test-copilot', OPENCODE_DATA_DIR: '/nonexistent/grove-test-opencode' },
  },
})
