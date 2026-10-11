import anriArt from '../assets/strawberry/anri-study.webp'
import pensArt from '../assets/strawberry/pens.webp'
import rulerArt from '../assets/strawberry/ruler.webp'

/** A few things left on the desk around the page in the strawberry theme, Anri included. */
export function StrawberryDesk() {
  return (
    <div className="strawberry-desk" aria-hidden="true">
      <img className="desk-ruler" src={rulerArt} alt="" draggable={false} decoding="async" />
      <img className="desk-pens" src={pensArt} alt="" draggable={false} decoding="async" />
      <img className="desk-anri" src={anriArt} alt="" draggable={false} decoding="async" />
    </div>
  )
}
