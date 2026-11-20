import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Field } from './field.entity';
import { Farm } from '../farms/farm.entity';
import { HistoryEvent } from './field-history.entity';
import { BulkCreateFieldsDto, CreateFieldDto, UpdateFieldDto } from './dto/create-field.dto';

/** UPDATE … RETURNING through TypeORM's postgres driver yields [rows, count]; INSERT yields rows. */
function firstRow(result: any) {
  return Array.isArray(result?.[0]) ? result[0][0] : result?.[0];
}

const RETURNING = `RETURNING id, name, "farmId", irrigation, "areaHectares", "createdAt"`;

/** Smallest and largest field we accept, in hectares (100 m² … 10,000 ha). */
export const MIN_FIELD_HA = 0.01;
export const MAX_FIELD_HA = 10000;
/** Overlap below this share of the smaller field is a shared edge, not an overlap. */
const OVERLAP_MIN_SHARE = 0.01;
const OVERLAP_MIN_HA = 0.01;
/** Overlap above this share of both fields means it is the same field. */
const DUPLICATE_SHARE = 0.9;

type Query = (sql: string, params?: any[]) => Promise<any>;
type OverlapMode = 'reject' | 'clip' | 'allow' | 'skip';

export interface FieldConflict { id: string; name: string; overlapHa: number; areaHa: number; duplicate: boolean }
interface Prepared { geojson: string; areaHa: number; repaired: boolean }

/** A field problem the user can act on; code tells the client which choices to offer. */
class FieldProblem extends Error {
  constructor(public code: 'FIELD_GEOMETRY' | 'FIELD_OVERLAP' | 'FIELD_DUPLICATE', message: string, public extra: Record<string, any> = {}) {
    super(message);
  }
  toHttp() {
    const body = { message: this.message, code: this.code, ...this.extra };
    return this.code === 'FIELD_GEOMETRY' ? new BadRequestException(body) : new ConflictException(body);
  }
}

const fmtHa = (ha: number) => (ha < 1 ? `${Math.round(ha * 10000)} m²` : `${ha.toFixed(2)} ha`);

/**
 * Shape checks that need no database: GeoJSON Polygon, WGS84 range, at least three
 * distinct corners. Open rings are closed and repeated points dropped.
 */
export function normalizePolygon(boundary: any): { type: 'Polygon'; coordinates: number[][][] } {
  if (!boundary || boundary.type !== 'Polygon' || !Array.isArray(boundary.coordinates) || !boundary.coordinates.length) {
    throw new FieldProblem('FIELD_GEOMETRY', 'The boundary must be a polygon');
  }
  const rings = boundary.coordinates.map((ring: any, r: number) => {
    if (!Array.isArray(ring)) throw new FieldProblem('FIELD_GEOMETRY', 'The boundary is not a valid polygon');
    const pts: number[][] = [];
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2) throw new FieldProblem('FIELD_GEOMETRY', 'The boundary has an invalid point');
      const lng = Number(p[0]), lat = Number(p[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
        throw new FieldProblem('FIELD_GEOMETRY', 'Coordinates must be WGS84 longitude and latitude');
      }
      const last = pts[pts.length - 1];
      if (!last || last[0] !== lng || last[1] !== lat) pts.push([lng, lat]);
    }
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3) {
      throw new FieldProblem('FIELD_GEOMETRY', r === 0 ? 'A field needs at least three corners' : 'A cut-out needs at least three corners');
    }
    return [...pts, pts[0]];
  });
  return { type: 'Polygon', coordinates: rings };
}

@Injectable()
export class FieldsService {
  constructor(
    @InjectRepository(Field) private readonly fieldsRepo: Repository<Field>,
    @InjectRepository(Farm) private readonly farmsRepo: Repository<Farm>,
  ) {}

  private get q(): Query {
    return this.fieldsRepo.query.bind(this.fieldsRepo);
  }

  private async assertFarmInOrganization(farmId: string, organizationId: string) {
    const farm = await this.farmsRepo.findOne({ where: { id: farmId, organizationId } });
    if (!farm) throw new NotFoundException('المزرعة غير موجودة');
  }

  /** يتأكد أن الحقل يتبع مزرعة في منظمة المستخدم (عزل المستأجرين). تستخدمه وحدات المحاصيل والأنشطة أيضاً. */
  async assertFieldInOrganization(fieldId: string, organizationId: string) {
    const [row] = await this.q(
      `SELECT f.id FROM fields f JOIN farms fa ON fa.id = f."farmId"
       WHERE f.id::text = $1 AND fa."organizationId"::text = $2`,
      [fieldId, organizationId],
    );
    if (!row) throw new NotFoundException('الحقل غير موجود');
  }

  // ------------------------------------------------------------ geometry pipeline

  /**
   * Validates a boundary in PostGIS. A shape that is invalid only in a way PostGIS can
   * fix into one polygon (repeated points, a spike, wrong ring order) is repaired.
   * A shape whose edges cross each other is refused with the place where they cross.
   */
  async prepare(boundary: any, q: Query = this.q): Promise<Prepared> {
    const poly = normalizePolygon(boundary);
    let row: any;
    try {
      [row] = await q(
        `WITH raw AS (SELECT ST_SetSRID(ST_Force2D(ST_GeomFromGeoJSON($1)), 4326) AS g),
              chk AS (SELECT g, ST_IsValid(g) AS ok, ST_IsValidReason(g) AS reason FROM raw),
              fix AS (SELECT ok, reason, CASE WHEN ok THEN g ELSE ST_CollectionExtract(ST_MakeValid(g), 3) END AS g FROM chk)
         SELECT ok, reason, ST_NumGeometries(g) AS parts,
                ST_AsGeoJSON(CASE WHEN ST_NumGeometries(g) = 1 THEN ST_GeometryN(g, 1) ELSE g END) AS geojson,
                COALESCE(ST_Area(g::geography) / 10000, 0) AS ha
         FROM fix`,
        [JSON.stringify(poly)],
      );
    } catch {
      throw new FieldProblem('FIELD_GEOMETRY', 'The boundary is not a valid polygon');
    }
    const parts = Number(row.parts) || 0;
    if (!parts || !(Number(row.ha) > 0)) throw new FieldProblem('FIELD_GEOMETRY', 'The boundary has no area. Its corners lie on one line');
    if (!row.ok && parts !== 1) {
      const at = /\[([-\d.]+) ([-\d.]+)\]/.exec(row.reason || '');
      const where = at ? { lng: +at[1], lat: +at[2] } : undefined;
      if (/self-intersection|ring self/i.test(row.reason || '')) {
        throw new FieldProblem('FIELD_GEOMETRY', 'The boundary crosses itself. Move the points so the edges do not cross', { where });
      }
      throw new FieldProblem('FIELD_GEOMETRY', 'The boundary is not a valid polygon', { where });
    }
    const ha = Number(row.ha);
    if (!parts || !(ha > 0)) throw new FieldProblem('FIELD_GEOMETRY', 'The boundary has no area');
    if (ha < MIN_FIELD_HA) throw new FieldProblem('FIELD_GEOMETRY', `The field is too small (${fmtHa(ha)}). The smallest field is 100 m²`, { areaHa: ha });
    if (ha > MAX_FIELD_HA) {
      throw new FieldProblem('FIELD_GEOMETRY', `The field is too large (${Math.round(ha).toLocaleString('en')} ha). The largest field is 10,000 ha, so split it into several fields`, { areaHa: ha });
    }
    return { geojson: row.geojson, areaHa: ha, repaired: !row.ok };
  }

  /** Saved, not deleted fields of the organization that this shape overlaps. */
  async conflicts(geojson: string, areaHa: number, organizationId: string, excludeId: string | null, q: Query = this.q): Promise<FieldConflict[]> {
    const rows = await q(
      `WITH s AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g)
       SELECT f.id, f.name, f."areaHectares" AS "areaHa",
              ST_Area(ST_Intersection(ST_MakeValid(f.boundary), s.g)::geography) / 10000 AS "overlapHa"
       FROM fields f JOIN farms fa ON fa.id = f."farmId", s
       WHERE fa."organizationId"::text = $2 AND f."archivedAt" IS NULL AND f.boundary IS NOT NULL
         AND f.boundary && s.g AND ST_Intersects(f.boundary, s.g)
         AND ($3::text IS NULL OR f.id::text <> $3)`,
      [geojson, organizationId, excludeId],
    );
    return rows
      .map((r: any) => ({ id: r.id, name: r.name, areaHa: Number(r.areaHa) || 0, overlapHa: Number(r.overlapHa) || 0 }))
      .filter((r: any) => r.overlapHa >= OVERLAP_MIN_HA && r.overlapHa >= OVERLAP_MIN_SHARE * Math.min(areaHa, r.areaHa || areaHa))
      .map((r: any) => ({ ...r, duplicate: r.overlapHa >= DUPLICATE_SHARE * areaHa && r.overlapHa >= DUPLICATE_SHARE * (r.areaHa || areaHa) }))
      .sort((a: FieldConflict, b: FieldConflict) => b.overlapHa - a.overlapHa);
  }

  /** Cuts the overlapping parts away; if that splits the field, the largest piece is kept. */
  private async clip(geojson: string, ids: string[], q: Query): Promise<{ geojson: string; removedHa: number }> {
    const [row] = await q(
      `WITH s AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS g),
            o AS (SELECT ST_Union(ST_MakeValid(boundary)) AS u FROM fields WHERE id::text = ANY($2::text[])),
            d AS (SELECT ST_CollectionExtract(ST_MakeValid(ST_Difference(s.g, o.u)), 3) AS g, s.g AS orig FROM s, o),
            p AS (SELECT (SELECT dp.geom FROM ST_Dump(d.g) dp ORDER BY ST_Area(dp.geom::geography) DESC LIMIT 1) AS g, d.orig FROM d)
       SELECT ST_AsGeoJSON(p.g) AS geojson,
              (ST_Area(p.orig::geography) - COALESCE(ST_Area(p.g::geography), 0)) / 10000 AS "removedHa"
       FROM p`,
      [geojson, ids],
    );
    if (!row || !row.geojson) throw new FieldProblem('FIELD_GEOMETRY', 'Nothing is left of the field after cutting the overlap');
    return { geojson: row.geojson, removedHa: Number(row.removedHa) || 0 };
  }

  /**
   * Validate → find overlaps → apply the overlap choice. Returns the shape to save and
   * what happened to it, or throws a FieldProblem the client can show with choices.
   */
  private async resolveShape(boundary: any, organizationId: string, excludeId: string | null, mode: OverlapMode, q: Query) {
    let prep = await this.prepare(boundary, q);
    const found = await this.conflicts(prep.geojson, prep.areaHa, organizationId, excludeId, q);
    const dup = found.find((c) => c.duplicate);
    if (dup) {
      throw new FieldProblem('FIELD_DUPLICATE', `This field is already saved as “${dup.name}”`, { conflicts: found, areaHa: prep.areaHa });
    }
    let clippedHa = 0;
    if (found.length) {
      if (mode === 'reject' || mode === 'skip') {
        const list = found.slice(0, 3).map((c) => `${c.name} (${fmtHa(c.overlapHa)})`).join(', ') + (found.length > 3 ? ` and ${found.length - 3} more` : '');
        throw new FieldProblem('FIELD_OVERLAP', `The field overlaps ${found.length === 1 ? 'a saved field' : found.length + ' saved fields'}: ${list}`, { conflicts: found, areaHa: prep.areaHa });
      }
      if (mode === 'clip') {
        const cut = await this.clip(prep.geojson, found.map((c) => c.id), q);
        prep = { ...(await this.prepare(JSON.parse(cut.geojson), q)), repaired: prep.repaired };
        clippedHa = cut.removedHa;
      }
    }
    return { prep, clippedHa, overlapsKept: mode === 'allow' ? found.length : 0 };
  }

  private async nextName(organizationId: string, q: Query, taken: Set<string> = new Set()) {
    const rows = await q(
      `SELECT f.name FROM fields f JOIN farms fa ON fa.id = f."farmId"
       WHERE fa."organizationId"::text = $1 AND f.name ~ '^Field [0-9]+$'`,
      [organizationId],
    );
    let n = rows.reduce((m: number, r: any) => Math.max(m, parseInt(r.name.slice(6), 10) || 0), 0);
    taken.forEach((name) => { if (/^Field \d+$/.test(name)) n = Math.max(n, parseInt(name.slice(6), 10)); });
    return `Field ${n + 1}`;
  }

  private async log(fieldId: string, event: HistoryEvent, userId: string | null, detail: Record<string, any> | null, withShape: boolean, q: Query = this.q) {
    await q(
      `INSERT INTO field_history ("fieldId", event, boundary, "areaHectares", detail, "userId")
       SELECT id, $2, CASE WHEN $5::boolean THEN boundary END, CASE WHEN $5::boolean THEN "areaHectares" END, $3::jsonb, $4
       FROM fields WHERE id::text = $1`,
      [fieldId, event, detail ? JSON.stringify(detail) : null, userId, withShape],
    );
  }

  /** Fields saved before history existed get their current shape recorded before the first change. */
  private async ensureBaseline(fieldId: string, q: Query = this.q) {
    await q(
      `INSERT INTO field_history ("fieldId", event, boundary, "areaHectares", detail, "createdAt")
       SELECT f.id, 'created', f.boundary, f."areaHectares", '{"baseline":true}'::jsonb, f."createdAt"
       FROM fields f
       WHERE f.id::text = $1 AND NOT EXISTS (SELECT 1 FROM field_history h WHERE h."fieldId"::text = $1 AND h.boundary IS NOT NULL)`,
      [fieldId],
    );
  }

  // ------------------------------------------------------------ create

  /**
   * ينشئ حقلاً جديداً ويحسب المساحة بالهكتار مباشرةً من PostGIS
   * باستخدام ST_Area على نسخة Geography للحصول على متر مربع دقيق.
   * الهندسة تُمرَّر كمعامل SQL (وليس نصاً مدمجاً) لمنع حقن SQL.
   */
  async create(dto: CreateFieldDto, organizationId: string, userId: string | null = null) {
    await this.assertFarmInOrganization(dto.farmId, organizationId);
    try {
      return await this.fieldsRepo.manager.transaction(async (m) => {
        const q: Query = m.query.bind(m);
        const { prep, clippedHa, overlapsKept } = await this.resolveShape(dto.boundary, organizationId, null, dto.overlap || 'reject', q);
        const name = dto.name?.trim() || (await this.nextName(organizationId, q));
        const [row] = await q(
          `INSERT INTO fields (name, "farmId", irrigation, boundary, "areaHectares")
           SELECT $1, $2, $3, g, ST_Area(g::geography) / 10000
           FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) AS g) s
           ${RETURNING}`,
          [name, dto.farmId, dto.irrigation ?? null, prep.geojson],
        );
        const detail = { ...(prep.repaired ? { repaired: true } : {}), ...(clippedHa ? { clippedHa } : {}), ...(overlapsKept ? { overlapsKept } : {}) };
        await this.log(row.id, 'created', userId, Object.keys(detail).length ? detail : null, true, q);
        return { ...row, repaired: prep.repaired, clippedHa, overlapsKept };
      });
    } catch (err) {
      if (err instanceof FieldProblem) throw err.toHttp();
      throw err;
    }
  }

  /**
   * Imports many fields in one transaction. Each field goes through the same checks as a
   * drawn field, against saved fields and the fields earlier in the same file.
   * overlap = reject: nothing is saved if any field is invalid, overlapping or a duplicate,
   * and the answer lists every problem. skip: those fields are left out. clip / allow:
   * overlaps are cut away or kept; invalid fields and duplicates are left out.
   */
  async bulkCreate(dto: BulkCreateFieldsDto, organizationId: string, userId: string | null = null) {
    await this.assertFarmInOrganization(dto.farmId, organizationId);
    const mode = dto.overlap || 'reject';
    const problems: { index: number; name: string; code: string; message: string; conflicts?: FieldConflict[] }[] = [];
    let result: any;
    try {
      result = await this.fieldsRepo.manager.transaction(async (m) => {
        const q: Query = m.query.bind(m);
        const saved: any[] = [];
        const names = new Set<string>();
        let repaired = 0, clipped = 0;
        for (let i = 0; i < dto.fields.length; i++) {
          const item = dto.fields[i];
          const label = item.name?.trim() || `Field ${i + 1} in the file`;
          try {
            const { prep, clippedHa } = await this.resolveShape(item.boundary, organizationId, null, mode, q);
            const name = item.name?.trim() || (await this.nextName(organizationId, q, names));
            names.add(name);
            const [row] = await q(
              `INSERT INTO fields (name, "farmId", irrigation, boundary, "areaHectares")
               SELECT $1, $2, $3, g, ST_Area(g::geography) / 10000
               FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON($4), 4326) AS g) s
               ${RETURNING}`,
              [name, dto.farmId, dto.irrigation ?? null, prep.geojson],
            );
            await this.log(row.id, 'created', userId, { imported: true, ...(prep.repaired ? { repaired: true } : {}), ...(clippedHa ? { clippedHa } : {}) }, true, q);
            if (prep.repaired) repaired++;
            if (clippedHa) clipped++;
            saved.push(row);
          } catch (err) {
            if (!(err instanceof FieldProblem)) throw err;
            problems.push({ index: i, name: label, code: err.code, message: err.message, ...(err.extra.conflicts ? { conflicts: err.extra.conflicts } : {}) });
          }
        }
        if (mode === 'reject' && problems.length) throw new FieldProblem('FIELD_OVERLAP', 'problems', {});
        return { fields: saved, skipped: problems, repaired, clipped };
      });
    } catch (err) {
      if (!(err instanceof FieldProblem)) throw err;
      const geometry = problems.filter((p) => p.code === 'FIELD_GEOMETRY').length;
      const duplicate = problems.filter((p) => p.code === 'FIELD_DUPLICATE').length;
      const overlap = problems.length - geometry;
      const parts = [
        duplicate && `${duplicate} already saved`,
        overlap - duplicate && `${overlap - duplicate} overlapping saved fields or each other`,
        geometry && `${geometry} with an invalid shape`,
      ].filter(Boolean);
      const body = { message: `Nothing was imported: ${problems.length} of ${dto.fields.length} fields need a decision (${parts.join(', ')})`, code: 'FIELD_IMPORT_PROBLEMS', problems };
      throw overlap ? new ConflictException(body) : new BadRequestException(body);
    }
    return result;
  }

  // ------------------------------------------------------------ edit

  /** تعديل الاسم / الري / المزرعة / الحدود. تغيير الحدود يعيد حساب المساحة ويُحفظ في السجل. */
  async update(id: string, dto: UpdateFieldDto, organizationId: string, userId: string | null = null) {
    await this.assertFieldInOrganization(id, organizationId);
    if (dto.farmId) await this.assertFarmInOrganization(dto.farmId, organizationId);
    if (dto.name !== undefined && !dto.name.trim()) throw new BadRequestException('A field needs a name');
    try {
      return await this.fieldsRepo.manager.transaction(async (m) => {
        const q: Query = m.query.bind(m);
        const [before] = await q(`SELECT name, "farmId", irrigation FROM fields WHERE id::text = $1`, [id]);
        let shape: { prep: Prepared; clippedHa: number; overlapsKept: number } | null = null;
        if (dto.boundary) {
          shape = await this.resolveShape(dto.boundary, organizationId, id, dto.overlap || 'reject', q);
          await this.ensureBaseline(id, q);
        }
        const irrigation = dto.irrigation === undefined ? undefined : dto.irrigation || null;
        await q(
          `UPDATE fields SET
             name = COALESCE($2, name),
             "farmId" = COALESCE($3, "farmId"),
             irrigation = CASE WHEN $4::boolean THEN $5 ELSE irrigation END,
             boundary = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), boundary)
           WHERE id::text = $1`,
          [id, dto.name?.trim() || null, dto.farmId || null, irrigation !== undefined, irrigation ?? null, shape ? shape.prep.geojson : null],
        );
        const row = firstRow(await q(
          `UPDATE fields SET "areaHectares" = ST_Area(boundary::geography) / 10000 WHERE id::text = $1 ${RETURNING}`,
          [id],
        ));
        if (shape) {
          const detail = { ...(shape.prep.repaired ? { repaired: true } : {}), ...(shape.clippedHa ? { clippedHa: shape.clippedHa } : {}), ...(shape.overlapsKept ? { overlapsKept: shape.overlapsKept } : {}) };
          await this.log(id, 'boundary_edited', userId, Object.keys(detail).length ? detail : null, true, q);
        }
        if (dto.name?.trim() && dto.name.trim() !== before.name) await this.log(id, 'renamed', userId, { from: before.name, to: dto.name.trim() }, false, q);
        if (dto.farmId && dto.farmId !== before.farmId) await this.log(id, 'moved', userId, { fromFarmId: before.farmId, toFarmId: dto.farmId }, false, q);
        if (irrigation !== undefined && irrigation !== before.irrigation) await this.log(id, 'irrigation', userId, { from: before.irrigation, to: irrigation }, false, q);
        return { ...row, ...(shape ? { repaired: shape.prep.repaired, clippedHa: shape.clippedHa, overlapsKept: shape.overlapsKept } : {}) };
      });
    } catch (err) {
      if (err instanceof FieldProblem) throw err.toHttp();
      throw err;
    }
  }

  // ------------------------------------------------------------ history

  async history(id: string, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
    await this.ensureBaseline(id);
    return this.q(
      `SELECT h.id, h.event, h."areaHectares", h.detail, h."createdAt", u.email AS "userEmail",
              CASE WHEN h.boundary IS NULL THEN NULL ELSE ST_AsGeoJSON(h.boundary)::json END AS boundary
       FROM field_history h LEFT JOIN users u ON u.id::text = h."userId"
       WHERE h."fieldId"::text = $1
       ORDER BY h."createdAt" DESC, h.id`,
      [id],
    );
  }

  /** Puts an earlier boundary back. The current one stays in the history. */
  async restoreBoundary(id: string, historyId: string, organizationId: string, userId: string | null, overlap: OverlapMode = 'reject') {
    await this.assertFieldInOrganization(id, organizationId);
    const [h] = await this.q(
      `SELECT ST_AsGeoJSON(boundary) AS geojson, "createdAt" FROM field_history WHERE id::text = $1 AND "fieldId"::text = $2 AND boundary IS NOT NULL`,
      [historyId, id],
    );
    if (!h) throw new NotFoundException('This boundary version does not exist');
    try {
      return await this.fieldsRepo.manager.transaction(async (m) => {
        const q: Query = m.query.bind(m);
        const { prep, clippedHa } = await this.resolveShape(JSON.parse(h.geojson), organizationId, id, overlap, q);
        await this.ensureBaseline(id, q);
        const row = firstRow(await q(
          `UPDATE fields SET boundary = ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), "areaHectares" = ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)::geography) / 10000
           WHERE id::text = $1 ${RETURNING}`,
          [id, prep.geojson],
        ));
        await this.log(id, 'boundary_restored', userId, { from: h.createdAt, ...(clippedHa ? { clippedHa } : {}) }, true, q);
        return row;
      });
    } catch (err) {
      if (err instanceof FieldProblem) throw err.toHttp();
      throw err;
    }
  }

  // ------------------------------------------------------------ delete and restore

  /**
   * Deleting moves the field out of the farm but keeps it, its crops, activities and
   * history, so it can be restored. permanent = true removes it for good.
   */
  async remove(id: string, organizationId: string, userId: string | null = null, permanent = false) {
    await this.assertFieldInOrganization(id, organizationId);
    if (permanent) {
      await this.q(`DELETE FROM weather_snapshots WHERE "fieldId"::text = $1`, [id]).catch(() => undefined);
      await this.q(`DELETE FROM fields WHERE id::text = $1`, [id]);
      return { id, deleted: true, permanent: true };
    }
    const row = firstRow(await this.q(`UPDATE fields SET "archivedAt" = now() WHERE id::text = $1 AND "archivedAt" IS NULL RETURNING id`, [id]));
    if (row) await this.log(id, 'archived', userId, null, false);
    return { id, deleted: true, permanent: false };
  }

  async restore(id: string, organizationId: string, userId: string | null, overlap: OverlapMode = 'reject') {
    await this.assertFieldInOrganization(id, organizationId);
    const [f] = await this.q(`SELECT ST_AsGeoJSON(boundary) AS geojson, "archivedAt" FROM fields WHERE id::text = $1`, [id]);
    if (!f.archivedAt) return this.findOne(id, organizationId);
    try {
      return await this.fieldsRepo.manager.transaction(async (m) => {
        const q: Query = m.query.bind(m);
        if (f.geojson) {
          const { prep, clippedHa } = await this.resolveShape(JSON.parse(f.geojson), organizationId, id, overlap, q);
          if (clippedHa) {
            await this.ensureBaseline(id, q);
            await q(`UPDATE fields SET boundary = ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), "areaHectares" = $3 WHERE id::text = $1`, [id, prep.geojson, prep.areaHa]);
          }
        }
        const row = firstRow(await q(`UPDATE fields SET "archivedAt" = NULL WHERE id::text = $1 ${RETURNING}`, [id]));
        await this.log(id, 'restored', userId, null, true, q);
        return row;
      });
    } catch (err) {
      if (err instanceof FieldProblem) throw err.toHttp();
      throw err;
    }
  }

  /** Deleted fields of a farm, newest first, for the "Recently deleted" list. */
  async archived(farmId: string, organizationId: string) {
    await this.assertFarmInOrganization(farmId, organizationId);
    return this.q(
      `SELECT id, name, "areaHectares", "archivedAt" FROM fields WHERE "farmId"::text = $1 AND "archivedAt" IS NOT NULL ORDER BY "archivedAt" DESC`,
      [farmId],
    );
  }

  // ------------------------------------------------------------ read

  async findAllForFarm(farmId: string, organizationId: string) {
    await this.assertFarmInOrganization(farmId, organizationId);
    const fields = await this.fieldsRepo.find({ where: { farmId }, relations: ['crops'] });
    return fields.filter((f) => !f.archivedAt);
  }

  async findOne(id: string, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
    const field = await this.fieldsRepo.findOne({
      where: { id },
      relations: ['crops', 'activities', 'farm'],
    });
    if (!field) throw new NotFoundException('الحقل غير موجود');
    return field;
  }

  async getFarmBoundaries(farmId: string, organizationId: string) {
    await this.assertFarmInOrganization(farmId, organizationId);
    const [row] = await this.q(
      `SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', COALESCE(json_agg(json_build_object(
           'type', 'Feature',
           'id', id,
           'properties', json_build_object('id', id, 'name', name, 'areaHectares', "areaHectares", 'irrigation', irrigation),
           'geometry', ST_AsGeoJSON(boundary)::json
         ) ORDER BY "createdAt"), '[]'::json)
       ) AS fc
       FROM fields WHERE "farmId" = $1 AND boundary IS NOT NULL AND "archivedAt" IS NULL`,
      [farmId],
    );
    return row.fc;
  }

  /** يعيد حدود الحقل كـ GeoJSON جاهز للعرض على الخريطة (Leaflet). */
  async getBoundaryAsGeoJson(id: string, organizationId: string) {
    await this.assertFieldInOrganization(id, organizationId);
    const [row] = await this.q(`SELECT ST_AsGeoJSON(boundary) AS geojson FROM fields WHERE id = $1`, [id]);
    return row ? JSON.parse(row.geojson) : null;
  }

  /**
   * Checks a shape without saving it: area, repairs and overlaps. The map calls this
   * while a field is drawn or edited, so problems show before Save.
   */
  async check(boundary: any, organizationId: string, excludeId: string | null) {
    try {
      const prep = await this.prepare(boundary);
      const conflicts = await this.conflicts(prep.geojson, prep.areaHa, organizationId, excludeId);
      return { ok: true, areaHa: prep.areaHa, repaired: prep.repaired, conflicts, duplicate: conflicts.some((c) => c.duplicate) };
    } catch (err) {
      if (err instanceof FieldProblem) return { ok: false, code: err.code, message: err.message, ...err.extra };
      throw err;
    }
  }
}
