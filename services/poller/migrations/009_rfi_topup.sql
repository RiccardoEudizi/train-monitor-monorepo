-- Tier-3 top-up (60 stations): all RFI MAIN HUB / HUB / MAJOR stations
-- missing from the 200 in 004_majors.sql. 200 + 60 = 260 majors.
-- Source: RFI "Classificazione stazioni" PDF (260423, 2110 stations:
-- 25 MAIN HUB + 54 HUB + 119 MAJOR = 198 top-tier; 138 already majors).
-- RFI name -> ViaggiaTreno code mapping verified live 2026-09-22 against
-- elencoStazioni/0..22, and every code below returned a non-empty
-- partenze+arrivi board (same-day check).
-- Deliberately excluded:
--   S04701 (Genova P.Principe Sotterranea, MAIN HUB) — empty ViaggiaTreno
--     board, covered by S04700;
--   S06501 (Pisa S.Rossore) — already major under its ViaggiaTreno name
--     'PISA/BINARI PISA S.ROSSORE';
--   S05059 Forli' already major (bare 'FORLI' prefix-matches F00001..53
--     fermata rows, which are not stations).
-- Idempotent: safe to re-run after seed (seed never touches is_major).
UPDATE stations SET is_major = TRUE, updated_at = NOW() WHERE code IN (
	'S01529', 'S01031', 'S00601', 'S08671',
	'S01828', 'S01915', 'S00610', 'S02084',
	'S01003', 'S06908', 'S00606', 'S08326',
	'S04536', 'S08320', 'S08021', 'S01520',
	'S01321', 'S02336', 'S01640', 'S01650',
	'S01492', 'S01326', 'S01701', 'S01645',
	'S01649', 'S01630', 'S01639', 'S06910',
	'S09988', 'S09105', 'S09107', 'S09106',
	'S09108', 'S09104', 'S09800', 'S12134',
	'S02088', 'S02701', 'S03200', 'S09101',
	'S06422', 'S05811', 'S08322', 'S08236',
	'S08323', 'S08408', 'S02440', 'S02666',
	'S06909', 'S04505', 'S01325', 'S00229',
	'S06809', 'S11019', 'S00228', 'S01810',
	'S08329', 'S01205', 'S01061', 'S09810'
);
-- Codes in order: Bergamo, Busto Arsizio, Carmagnola, Cassino,
-- Codogno, Cremona, Cuneo, Desenzano-Sirmione,
-- Domodossola, Figline Valdarno, Fossano, Roma Gemelli,
-- Genova Pegli, Roma La Storta, Ladispoli-Cerveteri, Lecco,
-- Lissone-Muggio, Mantova, Milano Certosa, Milano Dateo,
-- Milano Forlanini, Milano Greco Pirelli, Milano Lambrate, Milano P.Garibaldi,
-- Milano P.Venezia, Milano S.Cristoforo, Milano Villapizzone, Montevarchi,
-- Napoli Afragola, Napoli Mergellina, Napoli Montesanto, Napoli P.Amedeo,
-- Napoli P.Cavour, Napoli P.Leopardi, Napoli S.Giovanni Barra, Palermo Notarbartolo,
-- Peschiera del Garda, Pordenone, Portogruaro-Caorle, Pozzuoli Solfatara,
-- Prato P.Serraglio, Ravenna, Roma Monte Mario, Roma Nomentana,
-- Roma S.Pietro, Roma Tuscolana, S.Bonifacio, S.Dona' di Piave-Jesolo,
-- S.Giovanni Valdarno, Sanremo, Sesto S.Giovanni, Settimo (TO),
-- Siena, Termoli, Torino Stura, Tortona,
-- Roma Valle Aurelia, Varese, Vigevano, Pompei.
