const VALID_MATCH_TYPES = ['exact', 'regex'] as const;
const VALID_ROLES = ['USER', 'ADMIN'] as const;
const MAX_REGEX_LENGTH = 500;

export class PermissionsService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async listPatterns() {
    return this.prisma.roleAssignmentPattern.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async createPattern(matchType: string, pattern: string, role: string) {
    this.validateMatchType(matchType);
    this.validateRole(role);
    this.validatePattern(matchType, pattern);

    return this.prisma.roleAssignmentPattern.create({
      data: { matchType, pattern, role },
    });
  }

  async updatePattern(id: number, data: { matchType?: string; pattern?: string; role?: string }) {
    if (data.matchType !== undefined) {
      this.validateMatchType(data.matchType);
    }
    if (data.role !== undefined) {
      this.validateRole(data.role);
    }

    // For pattern validation, we need the effective matchType
    const effectiveMatchType = data.matchType ?? (
      data.pattern !== undefined
        ? (await this.prisma.roleAssignmentPattern.findUnique({ where: { id } }))?.matchType
        : undefined
    );
    if (data.pattern !== undefined && effectiveMatchType) {
      this.validatePattern(effectiveMatchType, data.pattern);
    }

    return this.prisma.roleAssignmentPattern.update({
      where: { id },
      data,
    });
  }

  async deletePattern(id: number) {
    return this.prisma.roleAssignmentPattern.delete({
      where: { id },
    });
  }

  async matchEmail(email: string): Promise<string | null> {
    const patterns = await this.prisma.roleAssignmentPattern.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // Check exact matches first
    for (const p of patterns) {
      if (p.matchType === 'exact' && p.pattern === email) {
        return p.role;
      }
    }

    // Then check regex matches in creation order
    for (const p of patterns) {
      if (p.matchType === 'regex') {
        try {
          const re = new RegExp(p.pattern);
          if (re.test(email)) {
            return p.role;
          }
        } catch {
          // Skip invalid regex patterns
          continue;
        }
      }
    }

    return null;
  }

  private validateMatchType(matchType: string): void {
    if (!(VALID_MATCH_TYPES as readonly string[]).includes(matchType)) {
      throw new Error(`Invalid matchType: "${matchType}". Must be "exact" or "regex".`);
    }
  }

  private validateRole(role: string): void {
    if (!(VALID_ROLES as readonly string[]).includes(role)) {
      throw new Error(`Invalid role: "${role}". Must be "USER" or "ADMIN".`);
    }
  }

  private validatePattern(matchType: string, pattern: string): void {
    if (matchType === 'regex') {
      if (pattern.length > MAX_REGEX_LENGTH) {
        throw new Error(`Regex pattern exceeds maximum length of ${MAX_REGEX_LENGTH} characters.`);
      }
      try {
        new RegExp(pattern);
      } catch {
        throw new Error(`Invalid regex pattern: "${pattern}".`);
      }
    }
  }
}
