```markdown
# CACP Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the CACP TypeScript codebase. You'll learn how to structure files, write imports and exports, follow commit message conventions, and organize tests. This guide is ideal for contributors looking to maintain consistency and quality in the CACP project.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - Example: `userProfile.ts`, `dataFetcher.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { fetchData } from './dataFetcher';
    ```

### Export Style
- Use **named exports** for all exported functions, types, or constants.
  - Example:
    ```typescript
    // In dataFetcher.ts
    export function fetchData() { ... }
    export const API_URL = '...';
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `build` prefix for build-related changes.
  - Example:
    ```
    build: update dependencies for security patch
    ```

## Workflows

### Build Workflow
**Trigger:** When you need to update or modify build-related files or dependencies.
**Command:** `/build-update`

1. Make necessary changes to build configuration or dependencies.
2. Stage your changes: `git add .`
3. Commit using the conventional commit format with the `build` prefix:
    ```
    git commit -m "build: describe your change"
    ```
4. Push your changes to the repository.

## Testing Patterns

- Test files follow the `*.test.*` naming pattern.
  - Example: `userProfile.test.ts`
- The specific testing framework is not detected, but typical test files might look like:
    ```typescript
    import { fetchData } from './dataFetcher';

    describe('fetchData', () => {
      it('should return data', () => {
        // test implementation
      });
    });
    ```
- Place test files alongside the modules they test or in a dedicated test directory as per project structure.

## Commands
| Command        | Purpose                                      |
|----------------|----------------------------------------------|
| /build-update  | Run the build workflow for updating builds   |
```
