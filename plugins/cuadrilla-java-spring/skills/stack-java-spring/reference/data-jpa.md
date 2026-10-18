# Data access with Spring Data JPA (only when the profile declares it)

JPA is **off by default**. If the `## Project profile` declares "Spring Data JPA", these rules
replace `data-jdbc.md` for the repositories that use it, and the JPA `forbidden` pattern is
removed from `.claude/cuadrilla.json`. Everything else (layers, envelope, Flyway, transactions in
services) stays.

## Placement

- Entities (`@Entity`) and Spring Data interfaces (`JpaRepository<…>`) live in
  `<base>.infrastructure.persistence.jpa` and are package-private where possible.
- The domain repository interface stays the contract; an adapter in `infrastructure`
  implements it and maps entities ↔ domain records. **Entities never leave `infrastructure`**:
  no entity in a service signature, a controller, a response or a JSON body
  (`ArchitectureTest` rule: classes annotated `@Entity` are only accessed from `infrastructure`).
- Prefer interface/record **projections** (`List<OrderSummary> findByCustomerId(...)` returning
  a record, or `select new …Record(...)` in JPQL) for reads; load entities only to modify them.

## Configuration (mandatory)

```yaml
spring:
  jpa:
    open-in-view: false                 # lazy loading never happens during JSON rendering
    hibernate:
      ddl-auto: none                    # or validate; the schema changes only through Flyway
    properties:
      hibernate:
        default_batch_fetch_size: 50
        query:
          fail_on_pagination_over_collection_fetch: true
        jdbc:
          batch_size: 50
        order_inserts: true
        order_updates: true
```

## Mapping rules

- Every association is LAZY (`@ManyToOne(fetch = FetchType.LAZY)`, `@OneToOne(fetch = LAZY)`);
  `FetchType.EAGER` is forbidden.
- Fetch plans are explicit per use case: `@EntityGraph(attributePaths = {...})` on the
  repository method or `join fetch` in JPQL. No relying on lazy loading in a loop (N+1); a
  test with `spring.jpa.properties.hibernate.generate_statistics` or a query counter guards
  hot paths when the profile asks for it.
- Pagination over a collection fetch is forbidden (Hibernate would page in memory; the
  property above makes it fail). Page the root ids first, then fetch.
- Identifiers: `@GeneratedValue(strategy = IDENTITY)` or sequence per the profile;
  `equals/hashCode` based on the id with a constant `hashCode()` (or not overridden); never
  Lombok `@Data`/`@EqualsAndHashCode` on entities.
- Optimistic locking with `@Version` on aggregates edited concurrently.
- Table/column names explicit (`@Table(schema = "<schema>", name = "<prefix>_order")`,
  `@Column(name = "created_at")`), matching the Flyway migrations.
- Enums as `@Enumerated(EnumType.STRING)`.

## Queries

- Derived queries for trivial lookups; `@Query` JPQL with named parameters (`:customerId` +
  `@Param`) otherwise. `nativeQuery = true` only with named parameters and a comment why.
- Never build JPQL/SQL by concatenation; dynamic filters use `Specification`/Criteria or a
  JdbcClient query.
- Bulk updates with `@Modifying(clearAutomatically = true)` inside a service transaction.

## Transactions

- `@Transactional` on application services only (`readOnly = true` for reads, which also skips
  dirty checking). Spring Data's own transactional defaults on repository methods are not a
  substitute for the service boundary.
- Entities modified in a transaction are saved by dirty checking; calling `save()` on a managed
  entity is unnecessary but harmless — be consistent with the project.
