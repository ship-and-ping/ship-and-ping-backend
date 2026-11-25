export function Sheep({ large = false }: { large?: boolean }) {
  return (
    <span aria-hidden="true" className={large ? "sheep large" : "sheep"}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="150 130 940 1000"
        width="940"
        height="1000"
      >
        <title>쉽앤핑 양 (배경 없음)</title>

        <g id="pings" fill="none" stroke="#76E7C4" strokeWidth="18" opacity="0">
          <circle cx="415" cy="590" r="300" />
        </g>
        <g id="sheep">
          <g
            id="leg-3"
            fill="#F8F4FC"
            stroke="#261B40"
            strokeWidth="24"
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <path d="M384 992 C410 1000 440 1008 468 1016 L486 1044 L404 1044 Z" />
            <path d="M402 1056 L484 1056 Q490 1056 492 1062 L498 1100 Q499 1110 489 1110 L404 1110 Q394 1110 395 1100 L397 1062 Q398 1056 402 1056 Z" />
          </g>
          <g
            id="leg-4"
            fill="#F8F4FC"
            stroke="#261B40"
            strokeWidth="24"
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            <path d="M748 1006 C770 992 792 980 814 968 L858 1044 L778 1044 Z" />
            <path d="M782 1056 L852 1056 Q858 1056 860 1062 L866 1100 Q867 1110 857 1110 L792 1110 Q782 1110 783 1100 L776 1062 Q776 1056 782 1056 Z" />
          </g>
          <g id="body">
            <path
              d="M300 780 C390 810 500 800 575 752 C660 812 760 835 858 838 C858 900 830 950 760 980 C640 1010 500 1000 420 970 C360 950 300 950 275 920 C255 870 262 815 300 780 Z"
              fill="#F8F4FC"
              stroke="#261B40"
              strokeWidth="24"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
          </g>
          <g id="leg-1">
            <path
              d="M288 934 A68 68 0 0 1 424 934 C423 948 416 960 406 972 L350 1038 L262 1038 L289 950 Z"
              fill="#F8F4FC"
              stroke="#261B40"
              strokeWidth="24"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
            <circle cx="356" cy="932" r="22" fill="#261B40" />
            <path
              d="M262 1056 L336 1056 Q342 1056 341 1062 L334 1100 Q332 1110 322 1110 L256 1110 Q246 1110 248 1100 L256 1062 Q257 1056 262 1056 Z"
              fill="#F8F4FC"
              stroke="#261B40"
              strokeWidth="24"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
          </g>
          <g id="leg-2">
            <path
              d="M612 934 A68 68 0 0 1 748 934 C747 946 744 956 740 966 L716 1038 L634 1038 L613 950 Z"
              fill="#F8F4FC"
              stroke="#261B40"
              strokeWidth="24"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
            <circle cx="680" cy="932" r="22" fill="#261B40" />
            <path
              d="M642 1056 L712 1056 Q718 1056 719 1062 L724 1100 Q725 1110 715 1110 L644 1110 Q634 1110 635 1100 L637 1062 Q637 1056 642 1056 Z"
              fill="#F8F4FC"
              stroke="#261B40"
              strokeWidth="24"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
          </g>
          <g id="wool">
            <g
              fill="#C3A6FF"
              stroke="#261B40"
              strokeWidth="24"
              paintOrder="stroke"
            >
              <circle cx="565" cy="255" r="100" />
              <circle cx="765" cy="282" r="95" />
              <circle cx="922" cy="360" r="80" />
              <circle cx="690" cy="350" r="80" />
              <circle cx="850" cy="405" r="70" />
            </g>
            <g fill="#C3A6FF">
              <circle cx="565" cy="255" r="100" />
              <circle cx="765" cy="282" r="95" />
              <circle cx="922" cy="360" r="80" />
              <circle cx="690" cy="350" r="80" />
              <circle cx="850" cy="405" r="70" />
            </g>
          </g>
          <g id="horn">
            <path
              d="M655 438 C600 330 430 292 318 342 C198 396 168 545 232 645 C292 742 444 760 512 690 C580 620 562 502 470 472 C390 446 318 502 330 572 C335 600 348 610 360 614"
              fill="none"
              stroke="#261B40"
              strokeWidth="98"
              strokeLinecap="round"
            />
            <path
              d="M655 438 C600 330 430 292 318 342 C198 396 168 545 232 645 C292 742 444 760 512 690 C580 620 562 502 470 472 C390 446 318 502 330 572 C335 600 348 610 360 614"
              fill="none"
              stroke="#76E7C4"
              strokeWidth="72"
              strokeLinecap="round"
            />
            <circle cx="415" cy="600" r="40" fill="#C3A6FF" />
          </g>
          <g id="head">
            <path
              d="M535 435 C600 425 680 440 715 445 L800 425 C860 470 930 470 945 478 L970 530 C1010 545 1060 560 1065 600 C1068 640 1058 665 1050 690 C1020 760 900 805 820 805 C730 805 650 775 598 715 C630 650 645 600 640 590 C580 560 535 500 535 435 Z"
              fill="#F8F4FC"
              stroke="#261B40"
              strokeWidth="24"
              strokeLinejoin="round"
              paintOrder="stroke"
            />
            <path
              id="ear"
              d="M574 466 C618 478 654 510 670 548 C638 558 606 550 589 530 C576 512 572 490 574 466 Z"
              fill="#261B40"
            />
            <path
              id="mouth"
              d="M968 670 C990 690 1030 690 1050 665"
              fill="none"
              stroke="#261B40"
              strokeWidth="14"
              strokeLinecap="round"
            />
            <g id="eye">
              <ellipse cx="835" cy="577" rx="58" ry="62" fill="#261B40" />
              <ellipse
                cx="849"
                cy="549"
                rx="20"
                ry="16"
                fill="#F8F4FC"
                transform="rotate(35 849 549)"
              />
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
