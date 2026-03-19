# Pattern: Global Search Service

## When to Use

Any application with multiple entity types where users need to find
things across the whole system. Examples: searching for a user, a
project, a document, or an order from a single search box.

## Overview

A search service that queries multiple entity types in parallel and
returns unified, grouped results. The UI presents a single search input
in the top bar with a dropdown showing results grouped by type.

## Components

### 1. Search Service

```typescript
export interface SearchResult {
  type: string;         // "User", "Channel", "Message", etc.
  id: number;
  title: string;        // primary display text
  subtitle?: string;    // secondary text
  url: string;          // link to the detail page
}

export class SearchService {
  constructor(private prisma: PrismaClient) {}

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    if (query.length < 2) return [];

    const pattern = `%${query}%`;

    // Search each entity type in parallel
    const [users, channels, messages] = await Promise.all([
      this.searchUsers(pattern, limit),
      this.searchChannels(pattern, limit),
      this.searchMessages(pattern, limit),
    ]);

    return [...users, ...channels, ...messages];
  }

  private async searchUsers(pattern: string, limit: number): Promise<SearchResult[]> {
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: pattern.replace(/%/g, ''), mode: 'insensitive' } },
          { displayName: { contains: pattern.replace(/%/g, ''), mode: 'insensitive' } },
        ],
      },
      take: limit,
    });
    return users.map(u => ({
      type: 'User',
      id: u.id,
      title: u.displayName || u.email,
      subtitle: u.email,
      url: `/admin/users?highlight=${u.id}`,
    }));
  }

  // ... similar methods for other entity types
}
```

### 2. Search Route

```typescript
router.get('/api/search', requireAuth(), async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string') {
    return res.json([]);
  }
  const results = await registry.search.search(q);
  res.json(results);
});
```

### 3. Search UI Component

A debounced search input in the top bar:

```typescript
function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }

    const timer = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      setResults(await res.json());
      setIsOpen(true);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [query]);

  // Render dropdown grouped by result.type
}
```

### 4. Adding New Searchable Types

When adding a new entity type to the app, add a `searchFoo()` method to
SearchService and include it in the `Promise.all()` call. The pattern
is consistent across all entity types.

## Performance Notes

- Use `ILIKE` (case-insensitive) for PostgreSQL text search
- For larger datasets, consider adding PostgreSQL full-text search
  (`tsvector` columns with GIN indexes)
- The inventory app uses simple `ILIKE` and it performs well up to
  tens of thousands of records
- The 300ms debounce prevents excessive queries while typing

## Reference Implementation

- Inventory app: `server/src/services/search.service.ts`
- Inventory app: `server/src/routes/search.ts`
- Inventory app: `client/src/components/AppLayout.tsx` (search bar in top nav)
