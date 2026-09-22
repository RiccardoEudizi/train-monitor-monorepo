package main

// Canonical geographic region for stations listed by MORE THAN ONE
// ViaggiaTreno elencoStazioni endpoint (verified 2026-09-21: 102 codes
// out of 2846 appear in 2-3 regions — border/through stations claimed by
// neighbouring compartimenti, e.g. VERONA in 1+12, BOLOGNA in 1+8+12,
// NAPOLI in 5+18). Neither first-wins nor last-wins is correct, so these
// win over whatever the fetch loop saw. Single-region and bucket-0-only
// stations are unaffected.
//
// Single-source rule: this map + apps/web/src/lib/regions.ts are the two
// region definitions — DB is truth at runtime, these two files are the
// edit-time sources. If you fix a region here, mirror it in the web
// MAJOR_REGION_OVERRIDE / REGION_NAMES path and vice versa.
var canonicalRegion = map[string]int{
	"S00034": 1,  // Mortara (PV)
	"S00039": 1,  // Torreberetti (PV)
	"S00137": 4,  // Aosta
	"S00154": 3,  // Ivrea (TO)
	"S00245": 3,  // Vercelli
	"S00248": 3,  // Novara
	"S00462": 3,  // Asti
	"S00470": 3,  // Alessandria
	"S00622": 2,  // Breil sur Roya (FR, linea Cuneo-Ventimiglia)
	"S00742": 3,  // Ceva (CN)
	"S00867": 3,  // Acqui Terme (AL)
	"S00984": 3,  // Oleggio (NO)
	"S01020": 3,  // Arona (NO)
	"S01026": 1,  // Sesto Calende (VA)
	"S01037": 1,  // Rho (MI)
	"S01807": 1,  // Voghera (PV)
	"S01810": 3,  // Tortona (AL)
	"S01828": 1,  // Codogno (LO)
	"S01850": 1,  // Casalmaggiore (CR)
	"S01915": 1,  // Cremona
	"S01944": 1,  // Broni (PV)
	"S01960": 8,  // Castelvetro Piacentino (PC)
	"S02026": 22, // Bolzano
	"S02038": 21, // Trento
	"S02052": 12, // Peri (Dolcè, VR)
	"S02084": 1,  // Desenzano (BS)
	"S02319": 12, // Primolano (VI)
	"S02333": 1,  // Roverbella (MN)
	"S02336": 1,  // Mantova
	"S02344": 1,  // Gonzaga-Reggiolo (MN)
	"S02430": 12, // Verona Porta Nuova
	"S02593": 12, // Venezia S. Lucia
	"S02661": 10, // Cordovado (PN)
	"S02703": 10, // Sacile (PN)
	"S02830": 10, // Casarsa (PN)
	"S03200": 12, // Portogruaro-Caorle (VE)
	"S04103": 3,  // Ovada (AL)
	"S04207": 2,  // Arquata Scrivia (GE)
	"S04211": 2,  // Ronco Scrivia (GE)
	"S04534": 2,  // Genova Voltri
	"S04805": 2,  // S. Giuseppe di Cairo (SV)
	"S05000": 8,  // Piacenza
	"S05014": 8,  // Parma
	"S05032": 8,  // Modena
	"S05043": 8,  // Bologna Centrale
	"S05058": 8,  // Faenza (RA)
	"S05110": 8,  // Porretta Terme (BO)
	"S05134": 8,  // S. Benedetto Sambro (BO)
	"S05308": 1,  // Poggio Rusco (MN)
	"S05310": 12, // Nogara (VR)
	"S05710": 12, // Occhiobello (RO)
	"S05711": 8,  // Pontelagoscuro (FE)
	"S06007": 2,  // Sarzana (SP)
	"S06039": 13, // Grosseto
	"S06170": 2,  // S. Stefano di Magra (SP)
	"S06414": 13, // Pistoia
	"S06416": 13, // Prato
	"S06500": 13, // Pisa
	"S06610": 13, // Marradi (FI)
	"S06922": 13, // Terontola-Cortona (AR)
	"S06923": 6,  // Castiglion del Lago (PG)
	"S06925": 13, // Chiusi (SI)
	"S07004": 6,  // Perugia
	"S07102": 8,  // Cattolica (RN)
	"S07113": 11, // Ancona
	"S07209": 6,  // Fossato di Vico (PG)
	"S07226": 6,  // Terni
	"S07514": 11, // Porto d'Ascoli (AP)
	"S07810": 19, // Pescara
	"S07824": 19, // Vasto (CH)
	"S08008": 5,  // Montalto di Castro (VT)
	"S08207": 6,  // Attigliano-Bomarzo (TR)
	"S08209": 5,  // Orte (VT)
	"S08304": 5,  // Viterbo
	"S08409": 5,  // Roma Termini
	"S08519": 19, // Carsoli (AQ)
	"S08539": 19, // Sulmona (AQ)
	"S08640": 5,  // Formia-Gaeta (LT)
	"S08856": 19, // Balsorano (AQ)
	"S08910": 19, // Castel di Sangro (AQ)
	"S09053": 7,  // Isernia
	"S09060": 7,  // Venafro
	"S09200": 18, // Rocca d'Evandro (CE)
	"S09203": 18, // Vairano-Caianello (CE)
	"S09218": 18, // Napoli Centrale
	"S09311": 18, // Benevento
	"S09314": 18, // Apice (BN)
	"S09320": 16, // Orsara di Puglia (FG)
	"S09452": 7,  // Bosco Redole (CB)
	"S09620": 18, // Calitri-Pescopagano (AV)
	"S09829": 18, // Romagnano-Vietri-Salvitelle (SA)
	"S11019": 7,  // Termoli (CB)
	"S11021": 16, // Chieuti-Serracapriola (FG)
	"S11119": 16, // Bari Centrale
	"S11205": 16, // Rocchetta S. Antonio (FG)
	"S11304": 16, // Spinazzola (BT)
	"S11420": 15, // Potenza
	"S11461": 15, // Metaponto (MT)
	"S11465": 16, // Taranto
	"S11721": 18, // Sapri (SA)
	"S11725": 17, // Praia-Ajeta-Tortora (CS)
	"S11823": 17, // Crotone
}
