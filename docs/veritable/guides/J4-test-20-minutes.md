# J4 — guide de test en 20 minutes : une élection

Pour Lukas, au retour. Objectif : traverser la présidentielle française d'avril 2027 trois fois — la perdre, la voler, et la gagner honnêtement — pour voir ce que chaque choix coûte. Les chiffres sont des ordres de grandeur (aléa de croissance, chocs d'opinion des IA) ; le déroulé, lui, est déterministe dans ses grandes lignes.

## Mise en place (1 min)

```bash
npm run dev
```

Ouvrir http://localhost:9000 dans un vrai navigateur. **Solo** → **Nouvelle campagne** → « Europe, dix nations » → **France** → **Commencer**. Passer le tutoriel hérité. Dans la barre du haut, neuf écrans ; les quatre nouveaux : **Politique**, **Élection**, **Dirigeants**, **Objectifs et journal**. Rester à **×1** pour lire, **×5** pour laisser courir (un mois ≈ 12 s).

Pourquoi la France : semi-présidentielle, élection au 24 avril 2027 (quinze mois après le départ), six partis d'un bord à l'autre, un gouvernement qui gouverne seul et une presse libre (85 %) : la fraude s'y voit.

## 1. Lire l'état de départ (3 min)

**Dirigeants.** Le dirigeant en jeu (chef de l'État, 48 ans, traits sur sept axes : idéologie économie / autorité / souveraineté, agressivité, corruption, charisme, compétence). Les six partis avec leur part de départ (législatives 2024), leur idéologie et leur chef ; le parti « au gouvernement » en jaune. En bas, les neuf autres nations : régime, dirigeant, légitimité (80 % pour les démocraties, 50 % pour la Russie et la Turquie), stabilité, prochaine élection (Ukraine : suspendue tant que la guerre est sur son sol, ⏸).

**Politique.** Légitimité 80 % (base du régime), capital politique 30 / 100 (régénère ≈ 3 par mois avec un dirigeant moyen et une opinion à 0,5), corruption du dirigeant, liberté de la presse, contrôle des médias 0 %, risque de coup 0,00 % par mois (période de grâce de 36 mois comptée depuis le début de la campagne : aucun coup, nulle part, avant janvier 2029). Prochaine élection et **projection** des parts (le calcul du vote, sans tirage). Les huit groupes avec leur satisfaction (50 % au départ) et leur idéologie : c'est la distance entre l'idéologie d'un groupe et celle d'un parti qui fait le vote, pondérée par le charisme du chef ; un groupe mécontent lâche le parti au gouvernement. Curseurs « en vigueur → cible » : depuis le J4 un curseur bouge sur six mois. Le catalogue des 46 lois : coût en capital / coût d'abrogation, fenêtre idéologique, état (disponible, hors de la fenêtre du gouvernement, capital insuffisant, en vigueur).

**Objectifs et journal.** Épingler « Gagner une élection » et « Cinq ans de stabilité » (cinq au plus). Écrire une note. Le journal se filtre par catégorie.

## 2. La perdre (5 min)

Laisser tourner à ×5 en regardant **Élection** de temps en temps : la projection bouge avec la satisfaction des groupes. Pour la perdre à coup sûr, fâcher les groupes : **Budget** → TVA +8 points, dépenses sociales −5 points ; **Politique** → voter « Recul de l'âge de la retraite » (35 de capital : attendre d'avoir 35) ; chaque loi et chaque curseur se voient dans **Opinion** semaine après semaine.

| Chiffre                                | Sens | Ordre de grandeur                                                                                         |
| -------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| Opinion → Salariés, Retraités          | ↓    | 50 % → 30-35 % en trois mois (rampes des curseurs) ; les retraités −8 points de plus avec la loi          |
| Élection → projection du parti sortant | ↓    | la part du sortant (★) est multipliée par (0,5 + satisfaction) : elle glisse de 15 % vers 10 %            |
| Politique → capital                    | ↓    | −35 pour la loi, puis +3 par mois                                                                         |
| Journal (24 avril 2027)                | +    | « France : élection, X en tête (alternance) », puis « gouvernement formé (…), dirigé par … »              |
| Dirigeants                             | ↔    | nouveau dirigeant = chef du parti en tête ; le gouvernement change de couleur ; capital remis à 30        |
| Politique → lois                       | ↔    | « le gouvernement abrogera … le … » pour toute loi hors de sa fenêtre ; abrogée douze mois plus tard      |
| Politique → curseurs                   | ↔    | vos cibles restent (vous êtes l'État) mais les lois hors fenêtre partent : c'est le prix d'une alternance |

Ce qu'une alternance ne fait pas : elle ne termine rien. Vous continuez avec le nouveau gouvernement, ses lois accessibles (sa fenêtre) et les autres refusées (« hors de la fenêtre idéologique du gouvernement »).

## 3. La voler (5 min)

Recharger une sauvegarde d'avant l'élection (panneau **Véritable**, sauvegardes automatiques mensuelles) ou relancer une campagne et aller vite (×5, quatorze mois ≈ 3 min).

**Élection** → curseur **Fraude** à 20 % (parts déplacées vers le sortant). La ligne affiche la probabilité de détection : `4 × fraude × (1 − contrôle des médias) × liberté de la presse` = 4 × 0,2 × 1 × 0,85 = **68 %**. Puis **Propagande** à 2 % du PIB : ≈ 5 Md$ par mois pris au budget, +10 points de part au sortant.

| Chiffre                                     | Sens | Ordre de grandeur                                                                                                     |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| Élection → projection du sortant            | ↑    | +20 (fraude) +10 (propagande) : de 15 % à ≈ 45 %, en tête                                                             |
| Budget → dépenses                           | ↑    | la propagande se voit dans le solde chaque mois                                                                       |
| Au scrutin : deux tirages sur trois         |      | « France : fraude électorale révélée (20 % des voix déplacées) » : légitimité 80 % → **50 %**, stabilité −0,15        |
| Politique → risque de coup                  | =    | ×2 pendant douze mois, mais il reste affiché à 0 : la période de grâce court jusqu'en janvier 2029 (point à trancher) |
| Diplomatie → relations avec les démocraties | ↓    | −30 avec chaque démocratie (Allemagne, Royaume-Uni, Italie, Espagne, Pologne, Norvège)                                |
| Un tirage sur trois : rien n'est vu         |      | le sortant garde le pouvoir, +30 de capital ; la fraude est oubliée                                                   |

Pour rendre la fraude invisible : **Politique** → voter « Contrôle des médias » (30 de capital ; fenêtre autorité ≥ 0,2 : refusée à un gouvernement libéral, il faut d'abord une alternance vers la droite ou une réforme). Effet : contrôle des médias 50 %, ×1,2 au sortant, mais légitimité −0,1 immédiate, −20 de relations avec les démocraties, presse à 45 % → détection 4 × 0,2 × 0,5 × 0,45 = 18 %.

## 4. La gagner honnêtement (4 min)

Recharger encore. **Élection** → **Clientélisme** sur « Retraités » (le groupe le plus lourd, 20 % du vote) : +2 points de satisfaction par mois, corruption +1 point par mois, 0,3 % du PIB par mois de fuite. **Budget** → santé et éducation +2 points (jeunes, retraités), TVA −2 points (salariés). **Politique** → voter « Programme de logement » (20 de capital, jeunes +5, salariés +2).

| Chiffre                          | Sens | Ordre de grandeur                                                                             |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------- |
| Opinion → groupes ciblés         | ↑    | retraités 50 % → 65-70 % en un an ; jeunes 55-60 %                                            |
| Élection → projection du sortant | ↑    | le multiplicateur (0,5 + s) passe de 1 à 1,15-1,2 : le sortant remonte de 15 % à 18-20 %      |
| Politique → corruption           | ↑    | +1 point par mois de clientélisme ; la fuite budgétaire = 0,2 × corruption sur les programmes |
| Au scrutin                       |      | « sortant reconduit » : +30 de capital, objectif « Gagner une élection » atteint (+20, +0,05) |

Une élection honnête se gagne à la marge, sur plusieurs groupes, et se paie en budget et en corruption ; une élection volée se gagne à coup sûr et se paie deux fois sur trois en légitimité, en stabilité et en relations (le risque de coup doublé n'agit qu'après 2028, voir plus haut).

## 5. Ailleurs dans le monde (2 min)

**Dirigeants** → les autres nations. Sur dix ans headless (`docs/veritable/reports/J4/`), chaque nation connaît au moins une alternance dans au moins une graine, chaque campagne connaît des crises (troubles, coups, révolutions), la Russie tombe presque toujours en junte avant 2036 avec la formule de la consigne (légitimité 0,5, `coupBase` 0,01 : ≈ 2 % par mois) et rend le pouvoir quatre ans plus tard. Une junte se voit dans **Dirigeants** (régime « Junte », dirigeant « chef militaire » au nom généré) et dans le journal (« coup d'État ; X prend le pouvoir », « suspendu par eu » pour un membre de l'UE, « la junte rend le pouvoir aux civils »).

## Ce qui est normal et ce qui ne l'est pas

Normal : des curseurs qui mettent six mois à agir ; un capital qui plafonne à 100 ; des lois grisées (fenêtre, régime, capital) ; des dirigeants IA qui meurent et sont remplacés par leur parti (rare : la formule de vieillissement donne 0,7 % par an à 80 ans) ; des chocs d'opinion mensuels sur les nations IA ; des relations qui ne reviennent plus à 0 mais vers une affinité (blocs communs + proximité idéologique).

À signaler : une loi votée hors de la fenêtre du gouvernement ; une fraude jamais détectée en dix essais avec une presse libre ; une élection suspendue sans guerre sur le territoire ; un coup dans les trois ans qui suivent un changement de régime ; une junte qui dure plus de dix ans ; une sauvegarde rechargée où les partis, le dirigeant ou les lois ont changé.
